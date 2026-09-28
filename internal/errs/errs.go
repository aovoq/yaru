// 失敗の種類。サーバーは errors.Is で 404・400・409 に振り分ける。
// CLI は Error() の文字列をそのまま出すので、見える文言は包む前の message のままにする。
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5.5
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5.1
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5.10
package errs

import (
	"errors"
	"fmt"
)

// ErrNotFound は対象のファイルや id が無い。
var ErrNotFound = errors.New("not found")

// ErrInvalidArgument は引数やファイルの形が約束と違う。
var ErrInvalidArgument = errors.New("invalid argument")

// ErrConflict は読む前と書く前で状態が変わっていた。
var ErrConflict = errors.New("conflict")

// Wrap は message を Error() の文字列にし、kind を fmt.Errorf の %w で結ぶ。
// Error() に kind の文言を足すと CLI の出力が変わるので、見える文字列は message だけにする。
func Wrap(message string, kind error) error {
	return &classified{message: message, cause: fmt.Errorf("%s: %w", message, kind)}
}

type classified struct {
	message string
	cause   error
}

func (err *classified) Error() string { return err.message }

func (err *classified) Unwrap() error { return err.cause }
