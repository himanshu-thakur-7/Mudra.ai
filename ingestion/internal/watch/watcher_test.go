package watch

import (
	"reflect"
	"testing"
)

func TestExtractLinks(t *testing.T) {
	body := []byte(`<html><body>
		<a href="/Themes/Theme1/downloads/circulars/ARNCircular99.pdf">Circular 99</a>
		<a href="https://www.amfiindia.com/docs/other.PDF?v=2">Other</a>
		<a href="https://example.com/elsewhere.pdf">offsite</a>
		<a href="/contact-us">Contact</a>
		<a href="/Themes/Theme1/downloads/circulars/ARNCircular99.pdf">duplicate</a>
	</body></html>`)
	got := ExtractLinks(body, "https://www.amfiindia.com/distributor-corner/circulars", `(?i)amfiindia\.com/.*\.pdf`)
	want := []string{
		"https://www.amfiindia.com/Themes/Theme1/downloads/circulars/ARNCircular99.pdf",
		"https://www.amfiindia.com/docs/other.PDF?v=2",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestExtractLinksBadPattern(t *testing.T) {
	if links := ExtractLinks([]byte("<a href='x.pdf'>x</a>"), "https://a.com", "("); links != nil {
		t.Fatalf("expected nil for invalid pattern, got %v", links)
	}
}
