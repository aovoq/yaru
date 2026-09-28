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

const manifestJSON = `{"name":"yaru","short_name":"yaru","description":"Local issues. Markdown in .yaru.","start_url":"/","scope":"/","display":"standalone","background_color":"#010102","theme_color":"#010102","icons":[{"src":"/icon.svg","sizes":"any","type":"image/svg+xml","purpose":"any"},{"src":"/icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},{"src":"/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},{"src":"/icon-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]}`

func TestManifestIconsAndFontMatchTheTypeScriptBytes(t *testing.T) {
	handler := newTestServer(t, Configuration{}).Handler()
	manifest := perform(handler, http.MethodGet, loopbackURL+"/manifest.webmanifest", loopbackHost, "", "", nil)
	if manifest.Code != http.StatusOK {
		t.Fatalf("manifest status: expected 200, actual %d", manifest.Code)
	}
	if manifest.Header().Get("Content-Type") != "application/manifest+json" {
		t.Fatalf("manifest type: expected application/manifest+json, actual %s", manifest.Header().Get("Content-Type"))
	}
	if manifest.Header().Get("Cache-Control") != "" {
		t.Fatalf("manifest cache: expected none, actual %s", manifest.Header().Get("Cache-Control"))
	}
	if manifest.Body.String() != manifestJSON {
		t.Fatalf("manifest bytes:\n%s", manifest.Body.String())
	}
	assertSecurityHeaders(t, manifest.Header())

	svg := perform(handler, http.MethodGet, loopbackURL+"/icon.svg", loopbackHost, "", "", nil)
	if svg.Header().Get("Content-Type") != "image/svg+xml" || svg.Body.String() != iconSVG {
		t.Fatalf("svg: type %s body %s", svg.Header().Get("Content-Type"), svg.Body.String())
	}

	pngs := []struct {
		path string
		file string
		size string
	}{
		{path: "/apple-touch-icon.png", file: "apple-touch-icon.png", size: "180x180"},
		{path: "/icon-192.png", file: "icon-192.png", size: "192x192"},
		{path: "/icon-512.png", file: "icon-512.png", size: "512x512"},
		{path: "/icon-maskable-512.png", file: "icon-maskable-512.png", size: "512x512"},
	}
	for _, image := range pngs {
		response := perform(handler, http.MethodGet, loopbackURL+image.path, loopbackHost, "", "", nil)
		if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" {
			t.Fatalf("%s: status %d type %s", image.path, response.Code, response.Header().Get("Content-Type"))
		}
		if response.Header().Get("Cache-Control") != "" {
			t.Fatalf("%s cache: %s", image.path, response.Header().Get("Cache-Control"))
		}
		committed, err := os.ReadFile(filepath.Join("..", "..", "assets", "icons", image.file))
		if err != nil {
			t.Fatal(err)
		}
		if response.Body.String() != string(committed) {
			t.Fatalf("%s bytes differ from the committed PNG", image.path)
		}
		if pngSize(response.Body.Bytes()) != image.size {
			t.Fatalf("%s size: expected %s, actual %s", image.path, image.size, pngSize(response.Body.Bytes()))
		}
	}

	font := perform(handler, http.MethodGet, loopbackURL+fontPath, loopbackHost, "", "", nil)
	if font.Code != http.StatusOK || font.Header().Get("Content-Type") != "font/woff2" {
		t.Fatalf("font: status %d type %s", font.Code, font.Header().Get("Content-Type"))
	}
	if font.Header().Get("Cache-Control") != fontCacheControl {
		t.Fatalf("font cache: expected %s, actual %s", fontCacheControl, font.Header().Get("Cache-Control"))
	}
	committedFont, err := os.ReadFile(filepath.Join("..", "..", "assets", "fonts", "InterVariable.woff2"))
	if err != nil {
		t.Fatal(err)
	}
	if font.Body.String() != string(committedFont) {
		t.Fatal("font bytes differ from assets/fonts/InterVariable.woff2")
	}
	license := perform(handler, http.MethodGet, loopbackURL+"/assets/fonts/LICENSE.txt", loopbackHost, "", "", nil)
	if license.Code != http.StatusNotFound {
		t.Fatalf("license: expected 404, actual %d", license.Code)
	}
	worker := perform(handler, http.MethodGet, loopbackURL+"/sw.js", loopbackHost, "", "", nil)
	if worker.Code != http.StatusNotFound {
		t.Fatalf("service worker: expected 404, actual %d", worker.Code)
	}
	events := perform(handler, http.MethodGet, loopbackURL+"/events", loopbackHost, "", "", nil)
	if events.Code != http.StatusNotFound {
		t.Fatalf("/events: expected 404, actual %d", events.Code)
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
