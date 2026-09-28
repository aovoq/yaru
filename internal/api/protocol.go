// Connect のハンドラを http.Handler として返す。登録は internal/server が行う。
// 手続きは POST だけ。Content-Type は docs/spec/security.md の「Connect」の 4 つ。
// docs/spec/routes.md の「SPA と Connect への対応」
//
//declscope:core
package api

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"unicode/utf8"

	connect "connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/aovoq/yaru/gen/yaru/v1/yaruv1connect"
)

const (
	// IssueMountPath は IssueService を載せるパス。末尾のスラッシュを付ける。
	IssueMountPath = "/" + yaruv1connect.IssueServiceName + "/"
	// CommentMountPath は CommentService を載せるパス。
	CommentMountPath = "/" + yaruv1connect.CommentServiceName + "/"
	// PageMountPath は PageService を載せるパス。
	PageMountPath = "/" + yaruv1connect.PageServiceName + "/"
	// ProjectMountPath は ProjectService を載せるパス。
	ProjectMountPath = "/" + yaruv1connect.ProjectServiceName + "/"
)

// IssueHandler は issue の一覧、取得、保存。
// docs/spec/routes.md の GET /api/issues、GET /api/issues/:id、POST /api/issues
func IssueHandler() http.Handler {
	_, handler := yaruv1connect.NewIssueServiceHandler(issueService{}, handlerOptions()...)
	return protect(handler)
}

// CommentHandler はコメントの一覧と保存。
// docs/spec/routes.md の GET /api/comments、POST /api/comments
func CommentHandler() http.Handler {
	_, handler := yaruv1connect.NewCommentServiceHandler(commentService{}, handlerOptions()...)
	return protect(handler)
}

// PageHandler は板 1 画面。
// docs/spec/routes.md の GET /api/page
func PageHandler() http.Handler {
	_, handler := yaruv1connect.NewPageServiceHandler(pageService{}, handlerOptions()...)
	return protect(handler)
}

// ProjectHandler はプロジェクト一覧。
// docs/spec/routes.md の GET /
func ProjectHandler() http.Handler {
	_, handler := yaruv1connect.NewProjectServiceHandler(projectService{}, handlerOptions()...)
	return protect(handler)
}

func handlerOptions() []connect.HandlerOption {
	return []connect.HandlerOption{
		connect.WithCodec(&connectJSONCodec{name: "json"}),
		connect.WithCodec(&connectJSONCodec{name: "json; charset=utf-8"}),
	}
}

// protect は手続きに入る前に method と Content-Type を見る。ここでは .yaru を書かない。
// docs/spec/security.md の「Connect」
func protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			reject(response, http.StatusMethodNotAllowed, "rejected method: expected POST, actual "+request.Method)
			return
		}
		media, err := requestMediaType(request.Header.Get("Content-Type"))
		if err != nil || !allowedMediaType(media) {
			actual := media
			if err != nil {
				actual = request.Header.Get("Content-Type")
			}
			reject(response, http.StatusUnsupportedMediaType, "rejected content type: expected "+allowedMediaTypeList()+", actual "+safeHeaderValue(actual))
			return
		}
		next.ServeHTTP(response, request)
	})
}

func requestMediaType(header string) (string, error) {
	if header == "" {
		return "", nil
	}
	media, _, err := mime.ParseMediaType(header)
	if err != nil {
		return "", err
	}
	return media, nil
}

func allowedMediaType(media string) bool {
	switch media {
	case "application/proto", "application/json", "application/connect+proto", "application/connect+json":
		return true
	default:
		return false
	}
}

func allowedMediaTypeList() string {
	return "application/proto, application/json, application/connect+proto, or application/connect+json"
}

func reject(response http.ResponseWriter, status int, message string) {
	response.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if status == http.StatusMethodNotAllowed {
		response.Header().Set("Allow", http.MethodPost)
	}
	response.WriteHeader(status)
	if _, err := io.WriteString(response, message); err != nil {
		return
	}
}

// safeHeaderValue は制御文字を除き、128 バイトで切る。docs/spec/security.md の Host と同じ上限
func safeHeaderValue(value string) string {
	cleaned := strings.Map(func(character rune) rune {
		if character <= 0x1f || character == 0x7f {
			return -1
		}
		return character
	}, value)
	if len(cleaned) <= 128 {
		return cleaned
	}
	cut := cleaned[:128]
	for !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut
}

// connectJSONCodec は Connect の JSON。空の配列と false は残す。未設定の optional は出さない。
// docs/spec/routes.md の「新旧の返事の揃え方」
type connectJSONCodec struct {
	name string
}

func (codec *connectJSONCodec) Name() string { return codec.name }

func (codec *connectJSONCodec) Marshal(message any) ([]byte, error) {
	protoMessage, ok := message.(proto.Message)
	if !ok {
		return nil, fmt.Errorf("invalid connect message: expected a protobuf message, actual %T", message)
	}
	return protojson.MarshalOptions{EmitDefaultValues: true}.Marshal(protoMessage)
}

func (codec *connectJSONCodec) MarshalAppend(destination []byte, message any) ([]byte, error) {
	encoded, err := codec.Marshal(message)
	if err != nil {
		return nil, err
	}
	return append(destination, encoded...), nil
}

func (codec *connectJSONCodec) Unmarshal(binary []byte, message any) error {
	protoMessage, ok := message.(proto.Message)
	if !ok {
		return fmt.Errorf("invalid connect message: expected a protobuf message, actual %T", message)
	}
	if len(binary) == 0 {
		return fmt.Errorf("invalid json: expected a JSON object, actual empty")
	}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(binary, protoMessage); err != nil {
		return err
	}
	return nil
}

func (codec *connectJSONCodec) MarshalStable(message any) ([]byte, error) {
	return codec.Marshal(message)
}

func (codec *connectJSONCodec) IsBinary() bool { return false }
