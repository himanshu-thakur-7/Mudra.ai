// Package watch runs one lightweight goroutine per regulator target:
// rate-limit -> fetch listing page -> hash/diff -> extract new document links
// -> enqueue download jobs. Hundreds of targets cost almost nothing when idle.
package watch

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"

	"github.com/little-beast/compliance-ingestion/internal/config"
	"github.com/little-beast/compliance-ingestion/internal/httpx"
	"github.com/little-beast/compliance-ingestion/internal/limiter"
	"github.com/little-beast/compliance-ingestion/internal/queue"
	"github.com/little-beast/compliance-ingestion/internal/snapshot"
)

type Watcher struct {
	cfg    config.Config
	lim    *limiter.Limiter
	snaps  *snapshot.Store
	q      queue.Queue
	client *http.Client
	log    *slog.Logger
}

func New(cfg config.Config, lim *limiter.Limiter, snaps *snapshot.Store, q queue.Queue, log *slog.Logger) *Watcher {
	return &Watcher{
		cfg: cfg, lim: lim, snaps: snaps, q: q,
		client: httpx.NewClient(45 * time.Second),
		log:    log,
	}
}

// RunOnce sweeps every target a single time (used by `fleet sweep` and tests).
func (w *Watcher) RunOnce(ctx context.Context) error {
	w.q.PublishActivity(ctx, queue.Activity{
		Source: "watcher", Kind: "sweep_start",
		Detail: fmt.Sprintf("sweeping %d regulator targets", len(w.cfg.Targets)),
	})
	errs := make(chan error, len(w.cfg.Targets))
	for _, t := range w.cfg.Targets {
		t := t
		go func() { errs <- w.check(ctx, t) }()
	}
	var firstErr error
	for range w.cfg.Targets {
		if err := <-errs; err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// Watch polls all targets forever at the configured interval.
func (w *Watcher) Watch(ctx context.Context) {
	ticker := time.NewTicker(w.cfg.WatchInterval())
	defer ticker.Stop()
	for {
		if err := w.RunOnce(ctx); err != nil {
			w.log.Error("sweep error", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *Watcher) check(ctx context.Context, t config.Target) error {
	u, err := url.Parse(t.URL)
	if err != nil {
		return fmt.Errorf("%s: bad url: %w", t.Name, err)
	}
	if err := w.lim.Wait(ctx, u.Host); err != nil {
		return err
	}

	body, status, err := w.fetch(ctx, t.URL)
	if err != nil {
		w.log.Warn("fetch failed", "target", t.Name, "err", err)
		w.q.PublishActivity(ctx, queue.Activity{
			Source: "watcher", Kind: "fetch_failed", Regulator: t.Regulator,
			Detail: fmt.Sprintf("%s: %v", t.Name, err),
		})
		return nil // transient portal failures must not kill the sweep
	}
	if status != http.StatusOK {
		w.log.Warn("non-200 listing", "target", t.Name, "status", status)
		w.q.PublishActivity(ctx, queue.Activity{
			Source: "watcher", Kind: "fetch_failed", Regulator: t.Regulator,
			Detail: fmt.Sprintf("%s answered HTTP %d", t.Name, status),
		})
		return nil
	}

	newHash := snapshot.Hash(body)
	oldHash, err := w.snaps.Get(ctx, t.URL)
	if err != nil {
		return err
	}
	if oldHash == newHash {
		w.log.Info("unchanged", "target", t.Name)
		w.q.PublishActivity(ctx, queue.Activity{
			Source: "watcher", Kind: "unchanged", Regulator: t.Regulator,
			Detail: fmt.Sprintf("%s: no change (hash %s…)", t.Name, newHash[:10]),
		})
		return nil
	}

	links := ExtractLinks(body, t.URL, t.LinkPattern)
	enqueued := 0
	for _, link := range links {
		seen, err := w.q.IsSeen(ctx, t.Regulator, link)
		if err != nil {
			return err
		}
		if seen {
			continue
		}
		job := queue.DownloadJob{
			URL: link, Regulator: t.Regulator, SourcePage: t.URL,
			DiscoveredAt: time.Now().UTC().Format(time.RFC3339),
			PDFPattern:   t.PDFPattern,
		}
		// Push before MarkSeen: a crash in between re-enqueues next sweep
		// (duplicates are absorbed downstream) instead of losing the document.
		if err := w.q.PushDownload(ctx, job); err != nil {
			return err
		}
		if err := w.q.MarkSeen(ctx, t.Regulator, link); err != nil {
			return err
		}
		w.q.SetDocState(ctx, link, queue.StateDiscovered, "")
		enqueued++
	}
	// Hash is committed only after every new link is enqueued, so a mid-sweep
	// crash re-detects this change on the next run.
	if err := w.snaps.Set(ctx, t.URL, newHash); err != nil {
		return err
	}
	w.log.Info("listing changed", "target", t.Name, "candidate_links", len(links), "new_enqueued", enqueued)
	w.q.PublishActivity(ctx, queue.Activity{
		Source: "watcher", Kind: "changed", Regulator: t.Regulator,
		Detail: fmt.Sprintf("%s CHANGED: %d candidate links, %d new enqueued", t.Name, len(links), enqueued),
	})
	return nil
}

func (w *Watcher) fetch(ctx context.Context, rawURL string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("User-Agent", w.cfg.UserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/pdf,*/*")
	resp, err := w.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	return body, resp.StatusCode, err
}

var rawURLRe = regexp.MustCompile(`https?://[^\s"'<>\\]+`)

// ExtractBodyURLs finds document URLs anywhere in the page body — hrefs AND
// JS-embedded strings (SEBI detail pages carry the PDF only inside an inline
// iframe src like web/?file=https://.../sebi_data/attachdocs/....pdf).
func ExtractBodyURLs(body []byte, baseURL, pattern string) []string {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, raw := range rawURLRe.FindAllString(string(body), -1) {
		raw = strings.TrimRight(raw, ".,;)")
		if re.MatchString(raw) && !seen[raw] {
			seen[raw] = true
			out = append(out, raw)
		}
	}
	// Also resolve relative <a href> links the raw scan cannot see.
	for _, link := range ExtractLinks(body, baseURL, pattern) {
		if !seen[link] {
			seen[link] = true
			out = append(out, link)
		}
	}
	return out
}

// ExtractLinks pulls every <a href> from the page, resolves it against the
// base URL, and keeps those matching the target's link pattern.
func ExtractLinks(body []byte, baseURL, pattern string) []string {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return nil
	}

	seen := map[string]bool{}
	var out []string
	doc, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return nil
	}
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "a" {
			for _, a := range n.Attr {
				if a.Key != "href" {
					continue
				}
				ref, err := url.Parse(strings.TrimSpace(a.Val))
				if err != nil {
					continue
				}
				abs := base.ResolveReference(ref).String()
				if re.MatchString(abs) && !seen[abs] {
					seen[abs] = true
					out = append(out, abs)
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return out
}
