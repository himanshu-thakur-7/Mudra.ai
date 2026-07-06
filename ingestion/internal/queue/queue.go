// Package queue is the job broker between fleet stages and the Python
// processing service. The MVP broker is Redis lists (LPUSH/BRPOP) with JSON
// payloads; the Queue interface is the seam where RabbitMQ slots in for
// production (same payloads, exchange/queue instead of list keys).
package queue

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	DownloadQueue = "ingest:download" // fleet-internal: listing watcher -> downloader
	ProcessQueue  = "ingest:process"  // cross-language: downloader -> Python consumer
	SeenSetPrefix = "ingest:seen:"    // per-regulator set of already-handled doc URLs
	ActivityList  = "ingest:activity" // capped feed of structured fleet events (dashboard)
	DocStateHash  = "ingest:docstate" // url -> {state, sha256, ts}: the ingestion state machine
	activityCap   = 500
)

// Document lifecycle states (pillar: idempotent transactional ingestion).
// DISCOVERED -> DOWNLOADED -> PARSED -> CHUNKED are written by the fleet and
// the Python consumer; EMBEDDED/VERIFIED land when vetted clauses are merged.
const (
	StateDiscovered = "DISCOVERED"
	StateDownloaded = "DOWNLOADED"
)

// Activity is one dashboard-feed event. The Python consumer publishes the
// same shape, so the feed interleaves fleet and processing activity.
type Activity struct {
	TS        string `json:"ts"`
	Source    string `json:"source"` // watcher | downloader | consumer
	Kind      string `json:"kind"`   // sweep_start | unchanged | changed | stored | skipped | fetch_failed | processed | failed
	Regulator string `json:"regulator,omitempty"`
	Detail    string `json:"detail"`
}

// DownloadJob asks the downloader to fetch one newly discovered document.
type DownloadJob struct {
	URL          string `json:"url"`
	Regulator    string `json:"regulator"`
	SourcePage   string `json:"source_page"`
	DiscoveredAt string `json:"discovered_at"`
	// PDFPattern, when set, marks this as a detail-page hop: an HTML response
	// is mined for URLs matching the pattern instead of being skipped.
	PDFPattern string `json:"pdf_pattern,omitempty"`
}

// ProcessJob tells the Python service a PDF landed in the object store.
type ProcessJob struct {
	PDFPath      string `json:"pdf_path"`
	URL          string `json:"url"`         // the PDF itself
	SourcePage   string `json:"source_page"` // listing/detail page it was discovered on (lineage)
	Regulator    string `json:"regulator"`
	SHA256       string `json:"sha256"`
	DownloadedAt string `json:"downloaded_at"`
}

type Queue interface {
	PushDownload(ctx context.Context, job DownloadJob) error
	PopDownload(ctx context.Context, timeout time.Duration) (*DownloadJob, error)
	PushProcess(ctx context.Context, job ProcessJob) error
	IsSeen(ctx context.Context, regulator, url string) (bool, error)
	MarkSeen(ctx context.Context, regulator, url string) error
	PublishActivity(ctx context.Context, a Activity)
	SetDocState(ctx context.Context, url, state, sha256 string)
}

type RedisQueue struct{ rdb *redis.Client }

func NewRedis(rdb *redis.Client) *RedisQueue { return &RedisQueue{rdb: rdb} }

func (q *RedisQueue) PushDownload(ctx context.Context, job DownloadJob) error {
	b, _ := json.Marshal(job)
	return q.rdb.LPush(ctx, DownloadQueue, b).Err()
}

func (q *RedisQueue) PopDownload(ctx context.Context, timeout time.Duration) (*DownloadJob, error) {
	res, err := q.rdb.BRPop(ctx, timeout, DownloadQueue).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var job DownloadJob
	if err := json.Unmarshal([]byte(res[1]), &job); err != nil {
		return nil, err
	}
	return &job, nil
}

func (q *RedisQueue) PushProcess(ctx context.Context, job ProcessJob) error {
	b, _ := json.Marshal(job)
	return q.rdb.LPush(ctx, ProcessQueue, b).Err()
}

func (q *RedisQueue) IsSeen(ctx context.Context, regulator, url string) (bool, error) {
	return q.rdb.SIsMember(ctx, SeenSetPrefix+regulator, url).Result()
}

// MarkSeen is called only AFTER the download job is safely enqueued, so a
// crash in between re-enqueues (at-least-once) instead of losing the document.
// Duplicate deliveries are absorbed downstream: the downloader stores by
// content hash and the Python consumer is idempotent per sha256.
func (q *RedisQueue) MarkSeen(ctx context.Context, regulator, url string) error {
	return q.rdb.SAdd(ctx, SeenSetPrefix+regulator, url).Err()
}

// SetDocState records a document's position in the ingestion state machine.
// Best-effort like the activity feed: state loss must never block ingestion.
func (q *RedisQueue) SetDocState(ctx context.Context, url, state, sha256 string) {
	b, _ := json.Marshal(map[string]string{
		"state": state, "sha256": sha256,
		"ts": time.Now().UTC().Format(time.RFC3339),
	})
	_ = q.rdb.HSet(ctx, DocStateHash, url, b).Err()
}

// PublishActivity pushes a dashboard event (best-effort: feed loss must never
// affect ingestion, so errors are deliberately dropped).
func (q *RedisQueue) PublishActivity(ctx context.Context, a Activity) {
	if a.TS == "" {
		a.TS = time.Now().UTC().Format(time.RFC3339)
	}
	b, _ := json.Marshal(a)
	pipe := q.rdb.Pipeline()
	pipe.LPush(ctx, ActivityList, b)
	pipe.LTrim(ctx, ActivityList, 0, activityCap-1)
	_, _ = pipe.Exec(ctx)
}
