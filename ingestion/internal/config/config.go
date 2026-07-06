// Package config loads the regulator watch targets and fleet settings.
package config

import (
	"encoding/json"
	"os"
	"time"
)

// Target is one regulator listing page the fleet monitors for new circulars.
type Target struct {
	Regulator   string `json:"regulator"`    // SEBI | AMFI | RBI | IRDAI
	Name        string `json:"name"`         // human label, e.g. "SEBI circulars listing"
	URL         string `json:"url"`          // listing page to watch
	LinkPattern string `json:"link_pattern"` // regexp a candidate document link must match
}

// Config is the fleet configuration (targets.json).
type Config struct {
	RedisAddr string   `json:"redis_addr"`
	InboxDir  string   `json:"inbox_dir"` // local object store; S3 bucket in production
	UserAgent string   `json:"user_agent"`
	Targets   []Target `json:"targets"`

	// Per-domain token bucket: RatePerMinute tokens refill/min, Burst max tokens.
	RatePerMinute float64 `json:"rate_per_minute"`
	Burst         int     `json:"burst"`

	// WatchInterval between listing-page polls in watch mode.
	WatchIntervalSeconds int `json:"watch_interval_seconds"`
}

func (c Config) WatchInterval() time.Duration {
	if c.WatchIntervalSeconds <= 0 {
		return 30 * time.Minute
	}
	return time.Duration(c.WatchIntervalSeconds) * time.Second
}

func Load(path string) (Config, error) {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	if c.RedisAddr == "" {
		c.RedisAddr = "localhost:6379"
	}
	if c.UserAgent == "" {
		c.UserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
	}
	if c.RatePerMinute <= 0 {
		c.RatePerMinute = 6 // stay well under any regulator's radar
	}
	if c.Burst <= 0 {
		c.Burst = 3
	}
	return c, nil
}
