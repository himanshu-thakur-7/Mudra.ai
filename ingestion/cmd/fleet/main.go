// fleet — the distributed ingestion engine CLI.
//
//	fleet -config targets.json sweep   one pass: watch all targets, drain downloads
//	fleet -config targets.json watch   poll forever at watch_interval_seconds
//
// Architecture: goroutine watchers per target -> Redis token-bucket rate
// limiter (shared fleet-wide per domain) -> change detection by normalized
// page hash -> download jobs on a Redis-list broker -> PDFs into the object
// store -> ProcessJobs for the Python processing service.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/little-beast/compliance-ingestion/internal/config"
	"github.com/little-beast/compliance-ingestion/internal/download"
	"github.com/little-beast/compliance-ingestion/internal/limiter"
	"github.com/little-beast/compliance-ingestion/internal/queue"
	"github.com/little-beast/compliance-ingestion/internal/snapshot"
	"github.com/little-beast/compliance-ingestion/internal/watch"
)

func main() {
	cfgPath := flag.String("config", "targets.json", "path to targets.json")
	flag.Parse()
	mode := flag.Arg(0)
	if mode != "sweep" && mode != "watch" {
		fmt.Fprintln(os.Stderr, "usage: fleet -config targets.json <sweep|watch>")
		os.Exit(2)
	}

	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}

	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Error("redis unreachable", "addr", cfg.RedisAddr, "err", err)
		os.Exit(1)
	}

	lim := limiter.New(rdb, cfg.RatePerMinute, cfg.Burst)
	q := queue.NewRedis(rdb)
	snaps := snapshot.NewStore(rdb)
	watcher := watch.New(cfg, lim, snaps, q, log)
	dl := download.New(cfg, lim, q, log)

	switch mode {
	case "sweep":
		if err := watcher.RunOnce(ctx); err != nil {
			log.Error("sweep", "err", err)
		}
		if err := dl.Drain(ctx, 3*time.Second); err != nil && ctx.Err() == nil {
			log.Error("drain", "err", err)
		}
	case "watch":
		go dl.Drain(ctx, 0) // 0 timeout = block forever on BRPOP
		watcher.Watch(ctx)
	}
}
