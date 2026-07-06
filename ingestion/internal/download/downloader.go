// Package download consumes DownloadJobs, fetches the document under the same
// per-domain rate limits as the watcher, drops it into the object store
// (a local directory here; an S3 bucket in production), and hands off to the
// Python processing service via a ProcessJob.
package download

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/little-beast/compliance-ingestion/internal/config"
	"github.com/little-beast/compliance-ingestion/internal/httpx"
	"github.com/little-beast/compliance-ingestion/internal/limiter"
	"github.com/little-beast/compliance-ingestion/internal/queue"
	"github.com/little-beast/compliance-ingestion/internal/watch"
)

var unsafeName = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

type Downloader struct {
	cfg    config.Config
	lim    *limiter.Limiter
	q      queue.Queue
	client *http.Client
	log    *slog.Logger
}

func New(cfg config.Config, lim *limiter.Limiter, q queue.Queue, log *slog.Logger) *Downloader {
	return &Downloader{
		cfg: cfg, lim: lim, q: q,
		client: httpx.NewClient(120 * time.Second),
		log:    log,
	}
}

// Drain processes queued download jobs until the queue stays empty for
// idleFor (RunOnce mode) or ctx is cancelled.
func (d *Downloader) Drain(ctx context.Context, idleFor time.Duration) error {
	for {
		job, err := d.q.PopDownload(ctx, idleFor)
		if err != nil {
			return err
		}
		if job == nil {
			return nil // queue idle
		}
		if err := d.handle(ctx, *job); err != nil {
			d.log.Error("download failed", "url", job.URL, "err", err)
			d.q.PublishActivity(ctx, queue.Activity{
				Source: "downloader", Kind: "fetch_failed", Regulator: job.Regulator,
				Detail: fmt.Sprintf("download failed: %s (%v)", job.URL, err),
			})
		}
	}
}

func (d *Downloader) fetch(ctx context.Context, rawURL string) ([]byte, string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, "", err
	}
	if err := d.lim.Wait(ctx, u.Host); err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", d.cfg.UserAgent)
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 100<<20))
	return data, resp.Header.Get("Content-Type"), err
}

const maxHopPDFs = 3 // a detail page describes one circular; cap its attachments

func (d *Downloader) handle(ctx context.Context, job queue.DownloadJob) error {
	data, contentType, err := d.fetch(ctx, job.URL)
	if err != nil {
		return err
	}

	if isPDF(data, contentType) {
		return d.store(ctx, job, job.URL, data)
	}

	// Second hop: mine the detail page (incl. JS-embedded URLs) for PDFs.
	if job.PDFPattern != "" {
		pdfURLs := watch.ExtractBodyURLs(data, job.URL, job.PDFPattern)
		if len(pdfURLs) > maxHopPDFs {
			pdfURLs = pdfURLs[:maxHopPDFs]
		}
		stored := 0
		for _, pu := range pdfURLs {
			pdata, pct, perr := d.fetch(ctx, pu)
			if perr != nil {
				d.log.Warn("hop fetch failed", "url", pu, "err", perr)
				continue
			}
			if !isPDF(pdata, pct) {
				continue
			}
			if serr := d.store(ctx, job, pu, pdata); serr != nil {
				return serr
			}
			stored++
		}
		if stored > 0 {
			return nil
		}
		d.q.PublishActivity(ctx, queue.Activity{
			Source: "downloader", Kind: "skipped", Regulator: job.Regulator,
			Detail: fmt.Sprintf("detail page had no fetchable PDF (%d candidates): %s", len(pdfURLs), job.URL),
		})
		return nil
	}

	d.log.Info("skipped non-PDF", "url", job.URL, "content_type", contentType)
	d.q.PublishActivity(ctx, queue.Activity{
		Source: "downloader", Kind: "skipped", Regulator: job.Regulator,
		Detail: fmt.Sprintf("non-PDF response (%s): %s", contentType, job.URL),
	})
	return nil
}

// store writes the PDF to the object store and hands off to processing.
// docURL is the actual PDF location (may differ from job.URL on a hop);
// lineage keeps both: the PDF URL and the detail/listing page it came from.
func (d *Downloader) store(ctx context.Context, job queue.DownloadJob, docURL string, data []byte) error {
	sum := sha256.Sum256(data)
	shaHex := hex.EncodeToString(sum[:])

	u, _ := url.Parse(docURL)
	dir := filepath.Join(d.cfg.InboxDir, strings.ToLower(job.Regulator))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	base := unsafeName.ReplaceAllString(filepath.Base(u.Path), "-")
	if !strings.HasSuffix(strings.ToLower(base), ".pdf") {
		base += ".pdf"
	}
	dest := filepath.Join(dir, shaHex[:8]+"-"+base)
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return err
	}

	d.log.Info("stored", "regulator", job.Regulator, "path", dest, "bytes", len(data))
	d.q.SetDocState(ctx, job.URL, queue.StateDownloaded, shaHex)
	d.q.PublishActivity(ctx, queue.Activity{
		Source: "downloader", Kind: "stored", Regulator: job.Regulator,
		Detail: fmt.Sprintf("stored %s (%d KB) → process queue", filepath.Base(dest), len(data)/1024),
	})
	return d.q.PushProcess(ctx, queue.ProcessJob{
		PDFPath: dest, URL: docURL, SourcePage: job.URL, Regulator: job.Regulator,
		SHA256: shaHex, DownloadedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func isPDF(data []byte, contentType string) bool {
	if len(data) >= 5 && string(data[:5]) == "%PDF-" {
		return true
	}
	return strings.Contains(strings.ToLower(contentType), "application/pdf")
}
