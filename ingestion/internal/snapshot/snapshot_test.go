package snapshot

import "testing"

func TestHashIgnoresVolatileMarkup(t *testing.T) {
	a := []byte(`<html><head><script>var t=123;</script><style>.x{}</style></head>
		<body><!-- ts:99 --> <a href="c1.pdf">Circular 1</a>  csrf_token="abc123"</body></html>`)
	b := []byte(`<html><head><script>var t=999;</script><style>.y{}</style></head>
		<body><!-- ts:11 -->    <a href="c1.pdf">Circular 1</a> csrf_token="zzz999"</body></html>`)
	if Hash(a) != Hash(b) {
		t.Fatal("hash should ignore scripts, styles, comments, nonces, whitespace")
	}
}

func TestHashDetectsContentChange(t *testing.T) {
	a := []byte(`<body><a href="c1.pdf">Circular 1</a></body>`)
	b := []byte(`<body><a href="c1.pdf">Circular 1</a><a href="c2.pdf">Circular 2</a></body>`)
	if Hash(a) == Hash(b) {
		t.Fatal("hash must change when a new circular is listed")
	}
}
