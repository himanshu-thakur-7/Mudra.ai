// Package limiter implements a distributed per-domain token bucket backed by
// Redis. Every worker in the fleet — on any machine — draws from the same
// bucket for a given domain, so the aggregate request rate to a regulator
// portal stays capped no matter how many goroutines or hosts are scraping.
package limiter

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// tokenBucketScript atomically refills and consumes one token.
// KEYS[1] = bucket key; ARGV = rate/min, burst, now-ms.
// Returns 1 if a token was granted, else the ms to wait before retrying.
var tokenBucketScript = redis.NewScript(`
local key    = KEYS[1]
local rate   = tonumber(ARGV[1])   -- tokens per minute
local burst  = tonumber(ARGV[2])
local now    = tonumber(ARGV[3])   -- ms

local data   = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts     = tonumber(data[2])
if tokens == nil then tokens = burst; ts = now end

local elapsed = math.max(0, now - ts) / 1000.0
tokens = math.min(burst, tokens + elapsed * (rate / 60.0))

if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
  redis.call('PEXPIRE', key, 3600000)
  return 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, 3600000)
return math.ceil(((1 - tokens) / (rate / 60.0)) * 1000)
`)

type Limiter struct {
	rdb   *redis.Client
	rate  float64
	burst int
}

func New(rdb *redis.Client, ratePerMinute float64, burst int) *Limiter {
	return &Limiter{rdb: rdb, rate: ratePerMinute, burst: burst}
}

// Wait blocks until a token is available for the domain (or ctx is done).
func (l *Limiter) Wait(ctx context.Context, domain string) error {
	key := fmt.Sprintf("ratelimit:%s", domain)
	for {
		res, err := tokenBucketScript.Run(ctx, l.rdb, []string{key},
			l.rate, l.burst, time.Now().UnixMilli()).Int64()
		if err != nil {
			return fmt.Errorf("rate limiter: %w", err)
		}
		if res == 1 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(res) * time.Millisecond):
		}
	}
}
