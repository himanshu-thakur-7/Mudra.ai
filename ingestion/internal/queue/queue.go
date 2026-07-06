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
)

// DownloadJob asks the downloader to fetch one newly discovered document.
type DownloadJob struct {
	URL          string `json:"url"`
	Regulator    string `json:"regulator"`
	SourcePage   string `json:"source_page"`
	DiscoveredAt string `json:"discovered_at"`
}

// ProcessJob tells the Python service a PDF landed in the object store.
type ProcessJob struct {
	PDFPath      string `json:"pdf_path"`
	URL          string `json:"url"`
	Regulator    string `json:"regulator"`
	SHA256       string `json:"sha256"`
	DownloadedAt string `json:"downloaded_at"`
}

type Queue interface {
	PushDownload(ctx context.Context, job DownloadJob) error
	PopDownload(ctx context.Context, timeout time.Duration) (*DownloadJob, error)
	PushProcess(ctx context.Context, job ProcessJob) error
	MarkSeen(ctx context.Context, regulator, url string) (bool, error) // false if already seen
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

// MarkSeen returns true when the URL is new (and records it atomically).
func (q *RedisQueue) MarkSeen(ctx context.Context, regulator, url string) (bool, error) {
	added, err := q.rdb.SAdd(ctx, SeenSetPrefix+regulator, url).Result()
	return added == 1, err
}
