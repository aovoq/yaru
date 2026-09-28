//declscope:core

package server

import (
	"encoding/binary"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
)

// manifest・アイコン・フォントは web/public のファイルで、Vite がそのまま web/dist に写す
// Go は dist の静的ファイルとして配るだけ。ここでは web/public を dist の代わりに渡す
func TestManifestIconsAndFontAreServedFromDist(t *testing.T) {
	publicDirectory := filepath.Join("..", "..", "web", "public")
	handler := newTestServer(t, Configuration{Dist: os.DirFS(publicDirectory)}).Handler()
	files := []struct {
		path        string
		contentType string
		pngSize     string
	}{
		{path: "/manifest.webmanifest", contentType: "application/manifest+json"},
		{path: "/icon.svg", contentType: "image/svg+xml"},
		{path: "/apple-touch-icon.png", contentType: "image/png", pngSize: "180x180"},
		{path: "/icon-192.png", contentType: "image/png", pngSize: "192x192"},
		{path: "/icon-512.png", contentType: "image/png", pngSize: "512x512"},
		{path: "/icon-maskable-512.png", contentType: "image/png", pngSize: "512x512"},
		{path: "/fonts/InterVariable.woff2", contentType: "font/woff2"},
	}
	for _, file := range files {
		response := perform(handler, http.MethodGet, loopbackURL+file.path, loopbackHost, "", "", nil)
		if response.Code != http.StatusOK || response.Header().Get("Content-Type") != file.contentType {
			t.Fatalf("%s: expected 200 %s, actual %d %s", file.path, file.contentType, response.Code, response.Header().Get("Content-Type"))
		}
		committed, err := os.ReadFile(filepath.Join(publicDirectory, filepath.FromSlash(file.path)))
		if err != nil {
			t.Fatal(err)
		}
		if response.Body.String() != string(committed) {
			t.Fatalf("%s: bytes differ from web/public%s", file.path, file.path)
		}
		if file.pngSize != "" && pngSize(response.Body.Bytes()) != file.pngSize {
			t.Fatalf("%s size: expected %s, actual %s", file.path, file.pngSize, pngSize(response.Body.Bytes()))
		}
		assertSecurityHeaders(t, response.Header())
	}
	for _, path := range []string{"/sw.js", "/events", "/assets/inter-4.1.woff2"} {
		response := perform(handler, http.MethodGet, loopbackURL+path, loopbackHost, "", "", nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s: expected 404, actual %d", path, response.Code)
		}
	}
}

// dist に無ければ、別の場所から探さない
func TestManifestIconsAndFontComeOnlyFromDist(t *testing.T) {
	handler := newTestServer(t, Configuration{Dist: fstest.MapFS{}}).Handler()
	for _, path := range []string{"/manifest.webmanifest", "/icon.svg", "/apple-touch-icon.png", "/icon-192.png", "/fonts/InterVariable.woff2"} {
		response := perform(handler, http.MethodGet, loopbackURL+path, loopbackHost, "", "", nil)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s: expected 404 without the file in dist, actual %d", path, response.Code)
		}
	}
}

func TestSPAPathsAndEmbeddedFiles(t *testing.T) {
	stateDirectory := t.TempDir()
	t.Setenv("YARU_STATE_DIR", stateDirectory)
	slug, _ := initWorkspace(t, stateDirectory, "board")
	dist := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<!doctype html><html><body>board</body></html>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log(1)\n")},
	}
	handler := newTestServer(t, Configuration{Dist: dist}).Handler()
	indexHTML := string(dist["index.html"].Data)
	for _, path := range []string{"/", "/inbox", "/terminal", "/p/" + slug, "/p/" + slug + "/", "/p/" + slug + "/dashboard"} {
		response := perform(handler, http.MethodGet, loopbackURL+path, loopbackHost, "", "", nil)
		if response.Code != http.StatusOK || response.Body.String() != indexHTML {
			t.Fatalf("%s: status %d body %s", path, response.Code, response.Body.String())
		}
		if response.Header().Get("Location") != "" {
			t.Fatalf("%s redirected to %s", path, response.Header().Get("Location"))
		}
	}
	missing := perform(handler, http.MethodGet, loopbackURL+"/p/missing", loopbackHost, "", "", nil)
	if missing.Code != http.StatusNotFound || missing.Body.String() != indexHTML || missing.Header().Get("Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("missing slug: %d %s %s", missing.Code, missing.Header().Get("Content-Type"), missing.Body.String())
	}
	script := perform(handler, http.MethodGet, loopbackURL+"/assets/app.js", loopbackHost, "", "", nil)
	if script.Code != http.StatusOK || script.Header().Get("Content-Type") != "text/javascript; charset=utf-8" || script.Body.String() != "console.log(1)\n" {
		t.Fatalf("script: %d %s %s", script.Code, script.Header().Get("Content-Type"), script.Body.String())
	}
	prefixed := perform(handler, http.MethodGet, loopbackURL+"/p/"+slug+"/assets/app.js", loopbackHost, "", "", nil)
	if prefixed.Code != http.StatusNotFound {
		t.Fatalf("prefixed static: expected 404, actual %d", prefixed.Code)
	}
	connectPath := perform(handler, http.MethodPost, loopbackURL+yaruv1connect.InboxServiceGetInboxProcedure, loopbackHost, loopbackOrigin, "{}", map[string]string{"Content-Type": "application/json"})
	if connectPath.Code == http.StatusNotFound {
		t.Fatalf("connect path was treated as a page: %d", connectPath.Code)
	}
}

func TestUnknownPagesUseTheDocument(t *testing.T) {
	// SPA に当たらない path と、登録の無い slug は 404 のまま index.html を返す。画面の 404 が出る。
	// API と静的ファイルが無いときの 404 は text/plain のまま。src/web.tsx:494-500、src/web.tsx:566-573。
	// docs/spec/routes.md の「SPA が受け取る path」。https://www.rfc-editor.org/rfc/rfc9110#section-15.5.5
	stateDirectory := t.TempDir()
	t.Setenv("YARU_STATE_DIR", stateDirectory)
	slug, _ := initWorkspace(t, stateDirectory, "board")
	dist := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<!doctype html><html><body>board</body></html>")},
	}
	handler := newTestServer(t, Configuration{Dist: dist}).Handler()
	indexHTML := string(dist["index.html"].Data)
	for _, path := range []string{"/missing", "/p/missing", "/p/missing/", "/p/missing/dashboard", "/p/" + slug + "/nope", "/terminal/"} {
		response := perform(handler, http.MethodGet, loopbackURL+path, loopbackHost, "", "", nil)
		if response.Code != http.StatusNotFound || response.Body.String() != indexHTML {
			t.Fatalf("%s: status %d body %s", path, response.Code, response.Body.String())
		}
		if response.Header().Get("Content-Type") != "text/html; charset=utf-8" {
			t.Fatalf("%s: content type %s", path, response.Header().Get("Content-Type"))
		}
		if response.Header().Get("Content-Security-Policy") != contentSecurityPolicy {
			t.Fatalf("%s: csp %s", path, response.Header().Get("Content-Security-Policy"))
		}
	}
	for _, path := range []string{"/assets/fonts/LICENSE.txt", "/sw.js", "/p/" + slug + "/assets/app.js", "/api/inbox"} {
		response := perform(handler, http.MethodGet, loopbackURL+path, loopbackHost, "", "", nil)
		if response.Code != http.StatusNotFound || response.Body.String() != "not found" || response.Header().Get("Content-Type") != plainTextUTF8 {
			t.Fatalf("%s: status %d type %s body %s", path, response.Code, response.Header().Get("Content-Type"), response.Body.String())
		}
	}
	posted := perform(handler, http.MethodPost, loopbackURL+"/missing", loopbackHost, loopbackOrigin, "", nil)
	if posted.Code != http.StatusNotFound || posted.Body.String() != "not found" {
		t.Fatalf("post: status %d body %s", posted.Code, posted.Body.String())
	}
}

func pngSize(body []byte) string {
	if len(body) < 24 {
		return "short"
	}
	width := binary.BigEndian.Uint32(body[16:20])
	height := binary.BigEndian.Uint32(body[20:24])
	return itoa(width) + "x" + itoa(height)
}

func itoa(value uint32) string {
	if value == 0 {
		return "0"
	}
	digits := [10]byte{}
	index := len(digits)
	for value > 0 {
		index--
		digits[index] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[index:])
}
