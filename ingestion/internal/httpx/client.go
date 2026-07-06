// Package httpx builds the fleet's HTTP client with DNS resilience.
//
// Indian ISP/router resolvers routinely fail on government domains (observed
// live: a local router returning NXDOMAIN for www.sebi.gov.in while public
// resolvers answer fine). The client therefore resolves through the system
// resolver first and falls back to public DNS (Google, Cloudflare) before
// giving up. TLS SNI/verification still uses the original hostname — only the
// dial address is swapped.
package httpx

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"
)

var fallbackDNS = []string{"8.8.8.8:53", "1.1.1.1:53"}

func resolverFor(dnsAddr string) *net.Resolver {
	return &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: 5 * time.Second}
			return d.DialContext(ctx, network, dnsAddr)
		},
	}
}

// lookup tries the system resolver, then each public fallback.
func lookup(ctx context.Context, host string) ([]string, error) {
	if ip := net.ParseIP(host); ip != nil {
		return []string{host}, nil
	}
	addrs, err := net.DefaultResolver.LookupHost(ctx, host)
	if err == nil && len(addrs) > 0 {
		return addrs, nil
	}
	for _, dns := range fallbackDNS {
		addrs, ferr := resolverFor(dns).LookupHost(ctx, host)
		if ferr == nil && len(addrs) > 0 {
			return addrs, nil
		}
	}
	return nil, fmt.Errorf("dns lookup %s failed on system and fallback resolvers: %w", host, err)
}

func dialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	addrs, err := lookup(ctx, host)
	if err != nil {
		return nil, err
	}
	d := net.Dialer{Timeout: 15 * time.Second}
	var lastErr error
	for _, ip := range addrs {
		conn, cerr := d.DialContext(ctx, network, net.JoinHostPort(ip, port))
		if cerr == nil {
			return conn, nil
		}
		lastErr = cerr
	}
	return nil, lastErr
}

// NewClient returns an http.Client with resolver fallback baked in.
func NewClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext:         dialContext,
			ForceAttemptHTTP2:   true,
			MaxIdleConnsPerHost: 4,
			IdleConnTimeout:     60 * time.Second,
		},
	}
}
