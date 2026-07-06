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

// Real-world SEBI detail-page shape: the PDF URL only exists inside an inline
// iframe src / JS string, never as an <a href>.
func TestExtractBodyURLsFindsJSEmbeddedPDF(t *testing.T) {
	body := []byte(`<html><body><script>
		var f = "../../../web/?file=https://www.sebi.gov.in/sebi_data/attachdocs/jul-2026/1783077132079.pdf' width='100%'";
	</script>
	<a href="https://www.sebi.gov.in/sebi_data/commondocs/annexure_1.PDF">Annexure</a>
	<a href="../../../index.html">home</a></body></html>`)
	got := ExtractBodyURLs(body, "https://www.sebi.gov.in/legal/circulars/jul-2026/x.html", `(?i)sebi\.gov\.in/.*\.pdf`)
	want := []string{
		"https://www.sebi.gov.in/sebi_data/attachdocs/jul-2026/1783077132079.pdf",
		"https://www.sebi.gov.in/sebi_data/commondocs/annexure_1.PDF",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
