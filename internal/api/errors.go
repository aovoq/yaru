// エラーの文は TS 版のまま。コードはメッセージに not found が含まれるかで分ける。
// src/web.tsx:84-97、docs/spec/routes.md の「エラーコード」
//
//declscope:core
package api

import (
	"errors"
	"strings"

	connect "connectrpc.com/connect"
)

func connectError(err error) error {
	if err == nil {
		return nil
	}
	code := connect.CodeInvalidArgument
	if strings.Contains(err.Error(), "not found") {
		code = connect.CodeNotFound
	}
	return connect.NewError(code, errors.New(err.Error()))
}

func invalidArgument(message string) error {
	return connect.NewError(connect.CodeInvalidArgument, errors.New(message))
}
