//declscope:core

package server

import (
	"net/http"

	"github.com/aovoq/yaru/assets"
	"github.com/aovoq/yaru/internal/document"
)

// manifestJSON は src/pwa.ts:26-41 の JSON.stringify と同じバイト列。
// JSON は document.MarshalJavaScript (encoding/json の HTML エスケープは使わない)。
const manifestDescription = "Local issues. Markdown in .yaru."

// iconSVG は src/logo.ts:20-26 の logoSvg("rounded")。
const iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#5e6ad2"/><path d="M160 212 L240 292 M352 140 L208 388" fill="none" stroke="#ffffff" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/></svg>`

// fontPath は src/font.ts:8。Cache-Control は src/font.ts:14。
const fontPath = "/assets/inter-4.1.woff2"
const fontCacheControl = "public, max-age=31536000, immutable"

type manifestIcon struct {
	Source  string `json:"src"`
	Sizes   string `json:"sizes"`
	Type    string `json:"type"`
	Purpose string `json:"purpose"`
}

type manifestDocument struct {
	Name            string         `json:"name"`
	ShortName       string         `json:"short_name"`
	Description     string         `json:"description"`
	StartURL        string         `json:"start_url"`
	Scope           string         `json:"scope"`
	Display         string         `json:"display"`
	BackgroundColor string         `json:"background_color"`
	ThemeColor      string         `json:"theme_color"`
	Icons           []manifestIcon `json:"icons"`
}

func manifestBytes() ([]byte, error) {
	return document.MarshalJavaScript(manifestDocument{
		Name:            "yaru",
		ShortName:       "yaru",
		Description:     manifestDescription,
		StartURL:        "/",
		Scope:           "/",
		Display:         "standalone",
		BackgroundColor: "#010102",
		ThemeColor:      "#010102",
		Icons: []manifestIcon{
			{Source: "/icon.svg", Sizes: "any", Type: "image/svg+xml", Purpose: "any"},
			{Source: "/icon-192.png", Sizes: "192x192", Type: "image/png", Purpose: "any"},
			{Source: "/icon-512.png", Sizes: "512x512", Type: "image/png", Purpose: "any"},
			{Source: "/icon-maskable-512.png", Sizes: "512x512", Type: "image/png", Purpose: "maskable"},
		},
	})
}

func (application *httpApplication) serveManifest(responseWriter http.ResponseWriter, request *http.Request) {
	body, err := manifestBytes()
	if err != nil {
		writeBody(responseWriter, request, http.StatusInternalServerError, plainTextUTF8, []byte("manifest: expected JSON, actual "+err.Error()))
		return
	}
	writeBody(responseWriter, request, http.StatusOK, "application/manifest+json", body)
}

func (application *httpApplication) serveIconSVG(responseWriter http.ResponseWriter, request *http.Request) {
	writeBody(responseWriter, request, http.StatusOK, "image/svg+xml", []byte(iconSVG))
}

func (application *httpApplication) servePNG(responseWriter http.ResponseWriter, request *http.Request, fileName string) {
	body, err := assets.Files.ReadFile("icons/" + fileName)
	if err != nil {
		writeBody(responseWriter, request, http.StatusInternalServerError, plainTextUTF8, []byte("icon: expected "+fileName+", actual "+err.Error()))
		return
	}
	writeBody(responseWriter, request, http.StatusOK, "image/png", body)
}

func (application *httpApplication) serveFont(responseWriter http.ResponseWriter, request *http.Request) {
	body, err := assets.Files.ReadFile("fonts/InterVariable.woff2")
	if err != nil {
		writeBody(responseWriter, request, http.StatusInternalServerError, plainTextUTF8, []byte("font: expected InterVariable.woff2, actual "+err.Error()))
		return
	}
	responseWriter.Header().Set("Cache-Control", fontCacheControl)
	writeBody(responseWriter, request, http.StatusOK, "font/woff2", body)
}
