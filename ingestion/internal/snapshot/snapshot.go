// Package snapshot detects listing-page changes without re-downloading every
// document: the watcher hashes the page's normalized DOM state and compares it
// with the previous run's hash in Redis. Only on a hash change does link
// extraction (and any downloading) happen.
package snapshot

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"

	"github.com/redis/go-redis/v9"
)

var (
	scriptRe   = regexp.MustCompile(`(?is)<script.*?</script>`)
	styleRe    = regexp.MustCompile(`(?is)<style.*?</style>`)
	commentRe  = regexp.MustCompile(`(?s)<!--.*?-->`)
	nonceRe    = regexp.MustCompile(`(?i)(csrf|token|nonce|timestamp|sessionid)["'= :]+[a-z0-9\-_.]+`)
	spaceRe    = regexp.MustCompile(`\s+`)
)

// Normalize strips volatile markup (scripts, styles, comments, CSRF nonces,
// whitespace) so the hash only changes when the listed content changes.
func Normalize(html []byte) []byte {
	h := scriptRe.ReplaceAll(html, nil)
	h = styleRe.ReplaceAll(h, nil)
	h = commentRe.ReplaceAll(h, nil)
	h = nonceRe.ReplaceAll(h, nil)
	h = spaceRe.ReplaceAll(h, []byte(" "))
	return h
}

func Hash(html []byte) string {
	sum := sha256.Sum256(Normalize(html))
	return hex.EncodeToString(sum[:])
}

type Store struct{ rdb *redis.Client }

func NewStore(rdb *redis.Client) *Store { return &Store{rdb: rdb} }

func key(targetURL string) string {
	sum := sha256.Sum256([]byte(targetURL))
	return fmt.Sprintf("ingest:snapshot:%s", hex.EncodeToString(sum[:8]))
}

// Changed stores the new hash and reports whether it differs from the last one.
// A first-ever observation counts as changed.
func (s *Store) Changed(ctx context.Context, targetURL, newHash string) (bool, error) {
	k := key(targetURL)
	old, err := s.rdb.Get(ctx, k).Result()
	if err != nil && err != redis.Nil {
		return false, err
	}
	if err := s.rdb.Set(ctx, k, newHash, 0).Err(); err != nil {
		return false, err
	}
	return old != newHash, nil
}
