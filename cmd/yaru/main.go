// yaru の CLI の入口。振り分けは internal/cli。常駐のサーバーは yaru serve から server.Serve を呼ぶ
// TS 版は src/index.ts
package main

import (
	"os"

	"github.com/aovoq/yaru/internal/cli"
)

func main() {
	os.Exit(cli.Run(cli.Invocation{
		Arguments: os.Args[1:],
		Stdin:     os.Stdin,
		Stdout:    os.Stdout,
		Stderr:    os.Stderr,
	}))
}
