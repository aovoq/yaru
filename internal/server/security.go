//declscope:core

package server

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

// すべての応答に付ける。/terminal の文書だけ style-src に unsafe-inline を足す。script-src には足さない。
// docs/spec/security.md の「応答ヘッダー」と「決定」。https://www.w3.org/TR/CSP3/#directive-style-src
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' http: https:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

const terminalContentSecurityPolicy = "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; img-src 'self' http: https:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

const plainTextUTF8 = "text/plain; charset=utf-8"

type securedResponse struct {
	http.ResponseWriter
	stripped bool
	policy   string
}

func (response *securedResponse) WriteHeader(status int) {
	response.enforce()
	response.ResponseWriter.WriteHeader(status)
}

func (response *securedResponse) Write(body []byte) (int, error) {
	response.enforce()
	return response.ResponseWriter.Write(body)
}

func (response *securedResponse) Flush() {
	if flusher, ok := response.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (response *securedResponse) Unwrap() http.ResponseWriter {
	return response.ResponseWriter
}

func (response *securedResponse) enforce() {
	if response.stripped {
		return
	}
	response.stripped = true
	header := response.Header()
	policy := response.policy
	if policy == "" {
		policy = contentSecurityPolicy
	}
	header.Set("Content-Security-Policy", policy)
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("X-Frame-Options", "DENY")
	// Cookie と CORS は返さない (docs/spec/security.md の「CSRF、Cookie、トークン」と「CORS」)
	header.Del("Set-Cookie")
	header.Del("Access-Control-Allow-Origin")
	header.Del("Access-Control-Allow-Credentials")
}

func authorize(request *http.Request, boundPort int, publicHost string) (string, bool) {
	hostName, hostPort, allowed := classifyHost(request.Host, boundPort, publicHost)
	if !allowed {
		return rejectedHostMessage(boundPort, request.Host), false
	}
	if len(request.Header.Values("Tailscale-Funnel-Request")) > 0 {
		return rejectedFunnelMessage(request.Header.Get("Tailscale-Funnel-Request")), false
	}
	origin := request.Header.Get("Origin")
	expectedOrigin := expectedOrigin(hostName, hostPort, publicHost)
	if isWebSocketUpgrade(request) {
		// Upgrade が websocket のときは Origin が必須。GET の「Origin が無ければ通す」は使わない。
		// docs/spec/security.md の「WebSocket」
		if origin != expectedOrigin {
			return rejectedOriginMessage(expectedOrigin, origin), false
		}
		if message, ok := sameOriginSite(request); !ok {
			return message, false
		}
		return "", true
	}
	if origin != "" && origin != expectedOrigin {
		return rejectedOriginMessage(expectedOrigin, origin), false
	}
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		if message, ok := mutatingRequestAllowed(origin, request); !ok {
			return message, false
		}
	}
	return "", true
}

func classifyHost(host string, boundPort int, publicHost string) (string, string, bool) {
	if host == "" || strings.Contains(host, "@") {
		return "", "", false
	}
	name, port, hasPort, splitOK := splitRequestHost(host)
	if !splitOK {
		return "", "", false
	}
	name = normalizeHostname(name)
	if name == "" {
		return "", "", false
	}
	bound := strconv.Itoa(boundPort)
	if (name == "127.0.0.1" || name == "localhost") && hasPort && port == bound {
		return name, port, true
	}
	if !hasPort && publicHost != "" && name == publicHost {
		return name, "", true
	}
	return "", "", false
}

func splitRequestHost(host string) (string, string, bool, bool) {
	if strings.HasPrefix(host, "[") {
		return "", "", false, false
	}
	if strings.ContainsAny(host, "/\\?#") || strings.Contains(host, " ") {
		return "", "", false, false
	}
	firstColon := strings.IndexByte(host, ':')
	if firstColon < 0 {
		return host, "", false, true
	}
	if strings.LastIndexByte(host, ':') != firstColon || firstColon == 0 || firstColon == len(host)-1 {
		return "", "", false, false
	}
	return host[:firstColon], host[firstColon+1:], true, true
}

func expectedOrigin(hostName string, hostPort string, publicHost string) string {
	if hostPort != "" {
		return "http://" + hostName + ":" + hostPort
	}
	return "https://" + publicHost
}

func isWebSocketUpgrade(request *http.Request) bool {
	for _, value := range request.Header.Values("Upgrade") {
		for _, token := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(token), "websocket") {
				return true
			}
		}
	}
	return false
}

func sameOriginSite(request *http.Request) (string, bool) {
	for _, value := range request.Header.Values("Sec-Fetch-Site") {
		if value != "same-origin" {
			return rejectedSecFetchMessage(value), false
		}
	}
	return "", true
}

func mutatingRequestAllowed(origin string, request *http.Request) (string, bool) {
	values := request.Header.Values("Sec-Fetch-Site")
	if origin == "" {
		if len(values) == 0 {
			return "", true
		}
		return rejectedSecFetchMessage(values[0]), false
	}
	for _, value := range values {
		if value != "same-origin" {
			return rejectedSecFetchMessage(value), false
		}
	}
	return "", true
}

func rejectedHostMessage(boundPort int, actual string) string {
	return fmt.Sprintf(
		"rejected host: expected 127.0.0.1:%d or localhost:%d or the configured public host, actual %s",
		boundPort,
		boundPort,
		showHeaderValue(actual),
	)
}

func rejectedOriginMessage(expected string, actual string) string {
	return fmt.Sprintf("rejected origin: expected %s, actual %s", expected, showHeaderValue(actual))
}

func rejectedFunnelMessage(actual string) string {
	return fmt.Sprintf(
		"rejected funnel request: expected no Tailscale-Funnel-Request header, actual %s",
		showHeaderValue(actual),
	)
}

func rejectedSecFetchMessage(actual string) string {
	return fmt.Sprintf("rejected sec-fetch-site: expected same-origin or absent, actual %s", showHeaderValue(actual))
}

func showHeaderValue(value string) string {
	sanitized := sanitizeHeaderValue(value)
	if sanitized == "" {
		return "<empty>"
	}
	return sanitized
}

// sanitizeHeaderValue は制御文字を除き、128 バイトで切る。403 の本文とログで同じ規則。
// docs/spec/security.md の「全部の入口での Host と Origin」と「ログ」
func sanitizeHeaderValue(value string) string {
	var builder strings.Builder
	builder.Grow(len(value))
	for _, character := range value {
		if character <= 0x1F || character == 0x7F {
			continue
		}
		builder.WriteRune(character)
	}
	sanitized := builder.String()
	if len(sanitized) <= 128 {
		return sanitized
	}
	cut := sanitized[:128]
	for cut != "" && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut
}

func reject(responseWriter http.ResponseWriter, request *http.Request, logOutput io.Writer, message string) {
	writeLine(logOutput, message)
	writeBody(responseWriter, request, http.StatusForbidden, plainTextUTF8, []byte(message))
}

func writeBody(responseWriter http.ResponseWriter, request *http.Request, status int, contentType string, body []byte) {
	header := responseWriter.Header()
	header.Set("Content-Type", contentType)
	header.Set("Content-Length", strconv.Itoa(len(body)))
	responseWriter.WriteHeader(status)
	if request != nil && request.Method == http.MethodHead {
		return
	}
	_, _ = responseWriter.Write(body)
}
