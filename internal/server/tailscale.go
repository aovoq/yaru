//declscope:core

package server

import (
	"encoding/json"
	"io"
	"os"
	"os/exec"
)

// tailscaleStatusLimit は status --json の読み取り上限。超えた出力は読めなかったものとして公開 host を無しにする。
const tailscaleStatusLimit = 32 << 20

// detectTailscaleDNSName は tailscale status --json の Self.DNSName を読む。
// 実行ファイルは YARU_TAILSCALE_BIN、無ければ PATH の tailscale。引数は status と --json だけ。
// 失敗しても起動は失敗させない。docs/spec/security.md の「許可する Host」
func detectTailscaleDNSName() (string, bool) {
	binaryPath := "tailscale"
	if configured, exists := os.LookupEnv("YARU_TAILSCALE_BIN"); exists {
		binaryPath = configured
	}
	command := exec.Command(binaryPath, "status", "--json")
	command.Stderr = io.Discard
	stdout, err := command.StdoutPipe()
	if err != nil {
		return "", false
	}
	if err := command.Start(); err != nil {
		return "", false
	}
	output, readErr := io.ReadAll(io.LimitReader(stdout, tailscaleStatusLimit+1))
	if len(output) > tailscaleStatusLimit {
		if command.Process != nil {
			_ = command.Process.Kill()
		}
		_ = command.Wait()
		return "", false
	}
	waitErr := command.Wait()
	if readErr != nil || waitErr != nil {
		return "", false
	}
	name, ok := selfDNSName(output)
	if !ok || name == "" {
		return "", false
	}
	return name, true
}

// tailscaleStatus は Self.DNSName だけを読む。Peer などの DNSName は見ない。
type tailscaleStatus struct {
	Self struct {
		DNSName string `json:"DNSName"`
	} `json:"Self"`
}

// selfDNSName は最上位の Self.DNSName だけを返す。他のオブジェクトの DNSName は見ない。
// yaru のファイルではないので document.MarshalJavaScript の対にはせず、encoding/json で必要なフィールドだけ読む。
func selfDNSName(data []byte) (string, bool) {
	var status tailscaleStatus
	if err := json.Unmarshal(data, &status); err != nil {
		return "", false
	}
	if status.Self.DNSName == "" {
		return "", false
	}
	return status.Self.DNSName, true
}
