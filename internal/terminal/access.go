//declscope:core

package terminal

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// ブラウザ向けの Host と Origin の検査。internal/server はまだ無いので、同じ規則をここに置く
// docs/spec/security.md の「全部の入口での Host と Origin」と「WebSocket」
// https://www.rfc-editor.org/rfc/rfc3986#section-3.2.2
// https://www.rfc-editor.org/rfc/rfc6455#section-1.6

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' http: https:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"

// rejectionLog は拒否の理由だけを書く。端末の入出力と query は書かない
// docs/spec/security.md の「ログ」
var rejectionLog io.Writer = os.Stderr

// ParsePublicHost は公開 host の設定を、比較に使う hostname だけにする
// ポート 443 は捨てる。URL、userinfo、空、443 以外のポートは拒否する
// docs/spec/security.md の「許可する Host」
func ParsePublicHost(value string) (string, error) {
	if value == "" {
		return "", fmt.Errorf("invalid public host: expected a hostname or a hostname with port 443, actual empty")
	}
	if strings.Contains(value, "@") || strings.ContainsAny(value, "/\\?#") || containsControl(value) || strings.ContainsAny(value, " \t") {
		return "", fmt.Errorf("invalid public host: expected a hostname or a hostname with port 443, actual %s", displayHeader(value))
	}
	host := value
	if strings.Contains(host, ":") {
		name, port, _ := strings.Cut(host, ":")
		if port != "443" || name == "" || strings.Contains(name, ":") || strings.Contains(port, ":") {
			return "", fmt.Errorf("invalid public host: expected a hostname or a hostname with port 443, actual %s", displayHeader(value))
		}
		host = name
	}
	host = strings.TrimRight(asciiLower(host), ".")
	if host == "" {
		return "", fmt.Errorf("invalid public host: expected a hostname or a hostname with port 443, actual %s", displayHeader(value))
	}
	return host, nil
}

// AuthorizeWebSocket はアップグレードしてよければ正規化した Host を返す
// Origin が無い、Host に対応する 1 つと違う、Sec-Fetch-Site が same-origin 以外、Funnel、は拒否する
// docs/spec/security.md の「WebSocket」。coder/websocket の Accept より前に呼ぶ (accept.go:229-232)
func AuthorizeWebSocket(request *http.Request, listenPort int, publicHost string) (string, error) {
	if listenPort < 1 || listenPort > 65535 {
		return "", fmt.Errorf("rejected host: expected a listen port from 1 to 65535, actual %d", listenPort)
	}
	canonicalPublic, _ := canonicalPublicHost(publicHost)
	normalizedHost, expectedOrigin, hostError := classifyHost(request.Host, listenPort, canonicalPublic)
	if hostError != nil {
		return "", hostError
	}
	if funnelValues := request.Header.Values("Tailscale-Funnel-Request"); len(funnelValues) > 0 {
		return "", fmt.Errorf("rejected tailscale funnel request: expected absent, actual %s", displayHeader(funnelValues[0]))
	}
	if request.Method != http.MethodGet {
		return "", fmt.Errorf("rejected method: expected GET, actual %s", displayHeader(request.Method))
	}
	if !headerHasToken(request.Header, "Upgrade", "websocket") {
		return "", fmt.Errorf("rejected upgrade: expected websocket, actual %s", displayHeader(request.Header.Get("Upgrade")))
	}
	origins := request.Header.Values("Origin")
	if len(origins) != 1 || origins[0] != expectedOrigin {
		actual := ""
		if len(origins) > 0 {
			actual = origins[0]
		}
		return "", fmt.Errorf("rejected origin: expected %s, actual %s", expectedOrigin, displayHeader(actual))
	}
	for _, site := range request.Header.Values("Sec-Fetch-Site") {
		if site != "same-origin" {
			return "", fmt.Errorf("rejected sec-fetch-site: expected same-origin or absent, actual %s", displayHeader(site))
		}
	}
	return normalizedHost, nil
}

func canonicalPublicHost(value string) (string, bool) {
	if value == "" {
		return "", false
	}
	parsed, err := ParsePublicHost(value)
	if err != nil {
		return "", false
	}
	return parsed, true
}

func classifyHost(host string, listenPort int, publicHost string) (string, string, error) {
	expected := expectedHosts(listenPort, publicHost)
	if host == "" || strings.Contains(host, "@") {
		return "", "", fmt.Errorf("rejected host: expected %s, actual %s", expected, displayHeader(host))
	}
	lowered := asciiLower(host)
	if strings.Count(lowered, ":") > 1 {
		return "", "", fmt.Errorf("rejected host: expected %s, actual %s", expected, displayHeader(host))
	}
	name := lowered
	port := ""
	if strings.Contains(lowered, ":") {
		var found bool
		name, port, found = strings.Cut(lowered, ":")
		if !found || strings.Contains(port, ":") {
			return "", "", fmt.Errorf("rejected host: expected %s, actual %s", expected, displayHeader(host))
		}
	}
	name = strings.TrimRight(name, ".")
	if name == "" {
		return "", "", fmt.Errorf("rejected host: expected %s, actual %s", expected, displayHeader(host))
	}
	listenPortText := fmt.Sprintf("%d", listenPort)
	switch {
	case port == listenPortText && name == "127.0.0.1":
		normalized := "127.0.0.1:" + listenPortText
		return normalized, "http://" + normalized, nil
	case port == listenPortText && name == "localhost":
		normalized := "localhost:" + listenPortText
		return normalized, "http://" + normalized, nil
	case port == "" && publicHost != "" && name == publicHost:
		return publicHost, "https://" + publicHost, nil
	default:
		return "", "", fmt.Errorf("rejected host: expected %s, actual %s", expected, displayHeader(host))
	}
}

func expectedHosts(listenPort int, publicHost string) string {
	loopback := fmt.Sprintf("127.0.0.1:%d or localhost:%d", listenPort, listenPort)
	if publicHost == "" {
		return loopback
	}
	return loopback + " or " + publicHost
}

func headerHasToken(header http.Header, name string, token string) bool {
	for _, value := range header.Values(name) {
		for _, part := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(part), token) {
				return true
			}
		}
	}
	return false
}

func setSecurityHeaders(response http.ResponseWriter) {
	header := response.Header()
	header.Set("Content-Security-Policy", contentSecurityPolicy)
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("X-Frame-Options", "DENY")
}

func writeText(response http.ResponseWriter, status int, message string) {
	response.Header().Set("Content-Type", "text/plain; charset=utf-8")
	response.WriteHeader(status)
	if _, err := io.WriteString(response, message); err != nil {
		return
	}
}

func logRejection(message string) {
	if _, err := fmt.Fprintf(rejectionLog, "%s\n", message); err != nil {
		return
	}
}

func displayHeader(value string) string {
	if value == "" {
		return "empty"
	}
	sanitized := sanitizeHeaderValue(value)
	if sanitized == "" {
		return "empty"
	}
	return sanitized
}

func sanitizeHeaderValue(value string) string {
	cleaned := make([]byte, 0, len(value))
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character < 0x20 || character == 0x7F {
			continue
		}
		cleaned = append(cleaned, character)
	}
	if len(cleaned) > 128 {
		cleaned = cleaned[:128]
	}
	return string(cleaned)
}

func containsControl(value string) bool {
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character < 0x20 || character == 0x7F {
			return true
		}
	}
	return false
}

func asciiLower(value string) string {
	lowered := make([]byte, len(value))
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character >= 'A' && character <= 'Z' {
			character = character - 'A' + 'a'
		}
		lowered[index] = character
	}
	return string(lowered)
}
