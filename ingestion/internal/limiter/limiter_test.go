package limiter

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// Integration test: needs a local Redis (skipped otherwise).
func TestTokenBucketCapsRate(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skip("redis not available")
	}
	domain := fmt.Sprintf("test-%d.example.com", time.Now().UnixNano())

	// 60/min = 1/sec, burst 2: five Waits should take >= ~2.5s (2 instant + 3 waited).
	lim := New(rdb, 60, 2)
	start := time.Now()
	for i := 0; i < 5; i++ {
		if err := lim.Wait(ctx, domain); err != nil {
			t.Fatal(err)
		}
	}
	if elapsed := time.Since(start); elapsed < 2500*time.Millisecond {
		t.Fatalf("5 requests at 1/sec burst 2 finished too fast: %v", elapsed)
	}
}
