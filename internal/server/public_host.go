//declscope:core

package server

import (
	"fmt"
	"os"
	"strings"
)

// resolvePublicHost は公開 host を 1 つ決める。フラグ、YARU_PUBLIC_HOST、tailscale の順。
// 空の YARU_PUBLIC_HOST は「公開 host は無し」で、自動検出はしない。未設定とは区別する。
// .yaru/config.yml の publicUrl は読まない。docs/spec/security.md の「許可する Host」
func resolvePublicHost(configuration Configuration) (string, error) {
	if configuration.PublicHostSet {
		return normalizePublicHost(configuration.PublicHost)
	}
	value, exists := os.LookupEnv("YARU_PUBLIC_HOST")
	if exists {
		if value == "" {
			return "", nil
		}
		return normalizePublicHost(value)
	}
	detected, ok := detectTailscaleDNSName()
	if !ok || detected == "" {
		return "", nil
	}
	return normalizePublicHost(detected)
}

func normalizePublicHost(raw string) (string, error) {
	if raw == "" {
		return "", invalidPublicHost(raw)
	}
	for _, character := range raw {
		if character <= 0x1F || character == 0x7F {
			return "", invalidPublicHost(raw)
		}
	}
	if strings.Contains(raw, "@") || strings.Contains(raw, "/") || strings.Contains(raw, "\\") || strings.ContainsAny(raw, "?# ") {
		return "", invalidPublicHost(raw)
	}
	name := raw
	if colon := strings.IndexByte(raw, ':'); colon >= 0 {
		if strings.LastIndexByte(raw, ':') != colon || colon == 0 || colon == len(raw)-1 {
			return "", invalidPublicHost(raw)
		}
		port := raw[colon+1:]
		if port != "443" {
			return "", invalidPublicHost(raw)
		}
		name = raw[:colon]
	}
	name = normalizeHostname(name)
	if name == "" || strings.HasPrefix(name, ".") || strings.Contains(name, "..") {
		return "", invalidPublicHost(raw)
	}
	return name, nil
}

func normalizeHostname(name string) string {
	name = strings.TrimRight(name, ".")
	var builder strings.Builder
	builder.Grow(len(name))
	for index := 0; index < len(name); index++ {
		character := name[index]
		if character >= 'A' && character <= 'Z' {
			character += 'a' - 'A'
		}
		builder.WriteByte(character)
	}
	return builder.String()
}

func invalidPublicHost(actual string) error {
	return fmt.Errorf("invalid public host: expected a hostname or a hostname with port 443, actual %s", showHeaderValue(actual))
}
