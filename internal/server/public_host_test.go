//declscope:core

package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSelfDNSNameIgnoresOtherObjects(t *testing.T) {
	name, ok := selfDNSName([]byte(`{"Peer":{"DNSName":"evil.example."},"Self":{"Online":true,"DNSName":"mac.example.ts.net."}}`))
	if !ok || name != "mac.example.ts.net." {
		t.Fatalf("dns name: expected mac.example.ts.net., actual %q %v", name, ok)
	}
	if _, ok := selfDNSName([]byte(`{"Self":{"DNSName":""}}`)); ok {
		t.Fatal("empty DNSName was accepted")
	}
	if _, ok := selfDNSName([]byte("not json")); ok {
		t.Fatal("invalid JSON was accepted")
	}
}

func TestEmptyPublicHostDoesNotRunTailscale(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "ran")
	script := filepath.Join(t.TempDir(), "tailscale")
	body := "#!/bin/sh\ntouch " + shellQuote(marker) + "\nexit 1\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YARU_PUBLIC_HOST", "")
	t.Setenv("YARU_TAILSCALE_BIN", script)
	handler := newTestServer(t, Configuration{}).Handler()
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("tailscale ran even though YARU_PUBLIC_HOST is empty")
	}
	response := perform(handler, http.MethodGet, "http://evil.example/", "evil.example", "https://evil.example", "", nil)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status: expected 403, actual %d", response.Code)
	}
}

func TestTailscaleDNSNameBecomesThePublicHost(t *testing.T) {
	arguments := filepath.Join(t.TempDir(), "arguments")
	script := filepath.Join(t.TempDir(), "tailscale")
	body := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + shellQuote(arguments) + "\nprintf '%s\\n' '{\"Self\":{\"DNSName\":\"mac.example.ts.net.\"}}'\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	unsetForTest(t, "YARU_PUBLIC_HOST")
	t.Setenv("YARU_TAILSCALE_BIN", script)
	handler := newTestServer(t, Configuration{}).Handler()
	recorded, err := os.ReadFile(arguments)
	if err != nil {
		t.Fatal(err)
	}
	if string(recorded) != "status\n--json\n" {
		t.Fatalf("arguments: expected status --json, actual %q", recorded)
	}
	response := perform(handler, http.MethodGet, "http://mac.example.ts.net/", "mac.example.ts.net", "https://mac.example.ts.net", "", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("status: expected 200, actual %d %s", response.Code, response.Body.String())
	}
	loopbackOnly := perform(handler, http.MethodGet, "http://evil.example/", "evil.example", "", "", nil)
	if loopbackOnly.Code != http.StatusForbidden {
		t.Fatal("a non-public host was accepted")
	}
}

func TestInvalidTailscaleDNSNameFailsStartup(t *testing.T) {
	script := filepath.Join(t.TempDir(), "tailscale")
	body := "#!/bin/sh\nprintf '%s\\n' '{\"Self\":{\"DNSName\":\"https://evil.example\"}}'\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	unsetForTest(t, "YARU_PUBLIC_HOST")
	t.Setenv("YARU_TAILSCALE_BIN", script)
	_, err := New(Configuration{Port: 47811, LogOutput: os.Stderr, StartupOutput: os.Stderr})
	if err == nil || !strings.Contains(err.Error(), "invalid public host:") || !strings.Contains(err.Error(), "https://evil.example") {
		t.Fatalf("expected invalid public host, actual %v", err)
	}
}

func TestTailscaleFailureLeavesLoopbackOnly(t *testing.T) {
	script := filepath.Join(t.TempDir(), "tailscale")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	unsetForTest(t, "YARU_PUBLIC_HOST")
	t.Setenv("YARU_TAILSCALE_BIN", script)
	handler := newTestServer(t, Configuration{}).Handler()
	response := perform(handler, http.MethodGet, loopbackURL+"/", loopbackHost, "", "", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("loopback: expected 200, actual %d", response.Code)
	}
	rejected := perform(handler, http.MethodGet, "http://mac.example.ts.net/", "mac.example.ts.net", "", "", nil)
	if rejected.Code != http.StatusForbidden {
		t.Fatal("failed tailscale still published a host")
	}
}

func TestPublicHostFlagWinsOverTheEnvironment(t *testing.T) {
	t.Setenv("YARU_PUBLIC_HOST", "from-env.example")
	handler := newTestServer(t, Configuration{PublicHost: "from-flag.example", PublicHostSet: true}).Handler()
	fromFlag := perform(handler, http.MethodGet, "http://from-flag.example/", "from-flag.example", "https://from-flag.example", "", nil)
	if fromFlag.Code != http.StatusOK {
		t.Fatalf("flag host: %d %s", fromFlag.Code, fromFlag.Body.String())
	}
	fromEnv := perform(handler, http.MethodGet, "http://from-env.example/", "from-env.example", "https://from-env.example", "", nil)
	if fromEnv.Code != http.StatusForbidden {
		t.Fatal("environment host was used even though the flag was set")
	}
}

func TestInvalidPublicHostFlag(t *testing.T) {
	_, err := New(Configuration{Port: 47811, PublicHost: "https://evil.example", PublicHostSet: true, LogOutput: os.Stderr, StartupOutput: os.Stderr})
	if err == nil || err.Error() != "invalid public host: expected a hostname or a hostname with port 443, actual https://evil.example" {
		t.Fatalf("error: %v", err)
	}
	normalized, err := New(Configuration{Port: 47811, PublicHost: "Mac.Example.Ts.Net.:443", PublicHostSet: true, LogOutput: os.Stderr, StartupOutput: os.Stderr})
	if err != nil {
		t.Fatal(err)
	}
	response := perform(normalized.Handler(), http.MethodGet, "http://mac.example.ts.net/", "mac.example.ts.net", "https://mac.example.ts.net", "", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("normalized flag: %d %s", response.Code, response.Body.String())
	}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}
