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
	"github.com/little-beast/compliance-ingestion/internal/limiter"
	"github.com/little-beast/compliance-ingestion/internal/queue"
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
		client: &http.Client{Timeout: 120 * time.Second},
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

func (d *Downloader) handle(ctx context.Context, job queue.DownloadJob) error {
	u, err := url.Parse(job.URL)
	if err != nil {
		return err
	}
	if err := d.lim.Wait(ctx, u.Host); err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, job.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", d.cfg.UserAgent)
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 100<<20))
	if err != nil {
		return err
	}
	if !isPDF(data, resp.Header.Get("Content-Type")) {
		d.log.Info("skipped non-PDF", "url", job.URL, "content_type", resp.Header.Get("Content-Type"))
		d.q.PublishActivity(ctx, queue.Activity{
			Source: "downloader", Kind: "skipped", Regulator: job.Regulator,
			Detail: fmt.Sprintf("non-PDF response (%s) from %s", resp.Header.Get("Content-Type"), u.Host),
		})
		return nil
	}

	sum := sha256.Sum256(data)
	shaHex := hex.EncodeToString(sum[:])

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
	d.q.PublishActivity(ctx, queue.Activity{
		Source: "downloader", Kind: "stored", Regulator: job.Regulator,
		Detail: fmt.Sprintf("stored %s (%d KB) → process queue", filepath.Base(dest), len(data)/1024),
	})
	return d.q.PushProcess(ctx, queue.ProcessJob{
		PDFPath: dest, URL: job.URL, Regulator: job.Regulator,
		SHA256: shaHex, DownloadedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func isPDF(data []byte, contentType string) bool {
	if len(data) >= 5 && string(data[:5]) == "%PDF-" {
		return true
	}
	return strings.Contains(strings.ToLower(contentType), "application/pdf")
}
