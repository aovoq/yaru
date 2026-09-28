//declscope:namespace issue

package store

import (
	"fmt"
	"reflect"
	"strings"
)

// 本文の部分更新。失敗した操作があると、それより前の操作もファイルには残さない。
// src/store.ts:870-991、docs/spec/yaru-format.md の「本文」。

const patchOperationMinimum = 1
const patchOperationMaximum = 50

var patchOperations = []string{"replace", "insert_before", "insert_after", "prepend", "append", "replace_range"}

// PatchOp は本文へ順に適用する 1 操作。src/store.ts:72-78
type PatchOp struct {
	Op         string
	OldString  string
	NewString  string
	ReplaceAll bool
	Anchor     string
	Text       string
	From       string
	To         string
}

// absent は JSON のオブジェクトにキーが無いこと。null とは分けて、TS の undefined に合わせる。
type absent struct{}

// ParsePatch は 1 件から 50 件の操作配列だけを受ける。src/store.ts:879-928
func ParsePatch(value any) ([]PatchOp, error) {
	items, ok := sliceItems(value)
	if !ok {
		actual, err := actualValue(value)
		if err != nil {
			return nil, err
		}
		return nil, errString("invalid patch: expected a JSON array of operations, actual " + actual)
	}
	if len(items) < patchOperationMinimum || len(items) > patchOperationMaximum {
		return nil, fmt.Errorf("invalid patch: expected 1 to 50 operations, actual %d", len(items))
	}
	operations := make([]PatchOp, 0, len(items))
	for _, item := range items {
		operation, err := parsePatchOp(item)
		if err != nil {
			return nil, err
		}
		operations = append(operations, operation)
	}
	return operations, nil
}

func parsePatchOp(value any) (PatchOp, error) {
	object, ok := objectFields(value)
	if !ok {
		actual, err := actualValue(value)
		if err != nil {
			return PatchOp{}, err
		}
		return PatchOp{}, errString("invalid patch: expected an operation object, actual " + actual)
	}
	op, exists := object["op"]
	opText, opIsString := op.(string)
	if !exists || !opIsString {
		return PatchOp{}, errString("invalid patch: op is required")
	}
	switch opText {
	case "replace":
		oldString, err := requiredText(object, "old_string", "replace", 1)
		if err != nil {
			return PatchOp{}, err
		}
		newString, err := requiredText(object, "new_string", "replace", 0)
		if err != nil {
			return PatchOp{}, err
		}
		operation := PatchOp{Op: opText, OldString: oldString, NewString: newString}
		if _, present := object["replace_all"]; present {
			replaceAll, err := requiredBoolean(object, "replace_all", "replace")
			if err != nil {
				return PatchOp{}, err
			}
			operation.ReplaceAll = replaceAll
		}
		return operation, nil
	case "insert_before", "insert_after":
		anchor, err := requiredText(object, "anchor", opText, 1)
		if err != nil {
			return PatchOp{}, err
		}
		text, err := requiredText(object, "text", opText, 1)
		if err != nil {
			return PatchOp{}, err
		}
		return PatchOp{Op: opText, Anchor: anchor, Text: text}, nil
	case "prepend", "append":
		text, err := requiredText(object, "text", opText, 1)
		if err != nil {
			return PatchOp{}, err
		}
		return PatchOp{Op: opText, Text: text}, nil
	case "replace_range":
		from, err := requiredText(object, "from", "replace_range", 1)
		if err != nil {
			return PatchOp{}, err
		}
		to, err := requiredText(object, "to", "replace_range", 1)
		if err != nil {
			return PatchOp{}, err
		}
		newString, err := requiredText(object, "new_string", "replace_range", 0)
		if err != nil {
			return PatchOp{}, err
		}
		return PatchOp{Op: opText, From: from, To: to, NewString: newString}, nil
	default:
		return PatchOp{}, errString("invalid patch: expected op " + JoinOr(patchOperations) + ", actual " + opText)
	}
}

func applyPatch(body string, operations []PatchOp) (string, error) {
	content := body
	for _, operation := range operations {
		next, err := applyPatchOp(content, operation)
		if err != nil {
			return "", err
		}
		content = next
	}
	return content, nil
}

func applyPatchOp(content string, operation PatchOp) (string, error) {
	switch operation.Op {
	case "replace":
		count := matchCount(content, operation.OldString)
		if operation.ReplaceAll {
			if count < 1 {
				return "", fmt.Errorf("patch replace: old_string must match the current body at least once, expected 1 or more matches, actual %d", count)
			}
			return strings.ReplaceAll(content, operation.OldString, operation.NewString), nil
		}
		if err := requireUnique(count, "replace", "old_string"); err != nil {
			return "", err
		}
		index := strings.Index(content, operation.OldString)
		return content[:index] + operation.NewString + content[index+len(operation.OldString):], nil
	case "insert_before", "insert_after":
		if err := requireUnique(matchCount(content, operation.Anchor), operation.Op, "anchor"); err != nil {
			return "", err
		}
		index := strings.Index(content, operation.Anchor)
		if operation.Op == "insert_before" {
			return content[:index] + operation.Text + content[index:], nil
		}
		end := index + len(operation.Anchor)
		return content[:end] + operation.Text + content[end:], nil
	case "prepend":
		return operation.Text + content, nil
	case "append":
		return content + operation.Text, nil
	default:
		if err := requireUnique(matchCount(content, operation.From), "replace_range", "from"); err != nil {
			return "", err
		}
		fromIndex := strings.Index(content, operation.From)
		afterFrom := fromIndex + len(operation.From)
		rest := content[afterFrom:]
		toCount := matchCount(rest, operation.To)
		if toCount != 1 {
			return "", fmt.Errorf("patch replace_range: to must match the current body exactly once after from, expected 1 match, actual %d", toCount)
		}
		toIndex := afterFrom + strings.Index(rest, operation.To)
		return content[:fromIndex] + operation.NewString + content[toIndex:], nil
	}
}

func requireUnique(count int, op string, field string) error {
	if count != 1 {
		return fmt.Errorf("patch %s: %s must match the current body exactly once, expected 1 match, actual %d", op, field, count)
	}
	return nil
}

func matchCount(haystack string, needle string) int {
	if needle == "" {
		return 0
	}
	count := 0
	from := 0
	for from <= len(haystack)-len(needle) {
		index := strings.Index(haystack[from:], needle)
		if index < 0 {
			return count
		}
		count++
		from += index + len(needle)
	}
	return count
}

func requiredText(object map[string]any, key string, op string, minimum int) (string, error) {
	field := lookupField(object, key)
	text, ok := field.(string)
	if !ok || len([]rune(text)) < minimum {
		actual, err := actualValue(field)
		if err != nil {
			return "", err
		}
		kind := "string"
		if minimum > 0 {
			kind = "non-empty string"
		}
		return "", errString("invalid patch " + op + ": " + key + " must be a " + kind + ", actual " + actual)
	}
	return text, nil
}

func requiredBoolean(object map[string]any, key string, op string) (bool, error) {
	field := lookupField(object, key)
	value, ok := field.(bool)
	if !ok {
		actual, err := actualValue(field)
		if err != nil {
			return false, err
		}
		return false, errString("invalid patch " + op + ": " + key + " must be a boolean, actual " + actual)
	}
	return value, nil
}

func lookupField(object map[string]any, key string) any {
	value, ok := object[key]
	if !ok {
		return absent{}
	}
	return value
}

func sliceItems(value any) ([]any, bool) {
	if value == nil {
		return nil, false
	}
	if _, ok := value.(absent); ok {
		return nil, false
	}
	reflected := reflect.ValueOf(value)
	if !reflected.IsValid() || reflected.Kind() != reflect.Slice {
		return nil, false
	}
	items := make([]any, reflected.Len())
	for index := 0; index < reflected.Len(); index++ {
		items[index] = reflected.Index(index).Interface()
	}
	return items, true
}

func objectFields(value any) (map[string]any, bool) {
	if value == nil {
		return nil, false
	}
	if object, ok := value.(map[string]any); ok {
		return object, true
	}
	reflected := reflect.ValueOf(value)
	if !reflected.IsValid() || reflected.Kind() != reflect.Map || reflected.Type().Key().Kind() != reflect.String {
		return nil, false
	}
	object := make(map[string]any, reflected.Len())
	for _, key := range reflected.MapKeys() {
		object[key.String()] = reflected.MapIndex(key).Interface()
	}
	return object, true
}

func actualValue(value any) (string, error) {
	if _, ok := value.(absent); ok {
		return "undefined", nil
	}
	if value == nil {
		return "null", nil
	}
	switch typed := value.(type) {
	case string:
		return quoteJavaScript(typed)
	case bool:
		if typed {
			return "true", nil
		}
		return "false", nil
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return formatJavaScriptNumber(asFloatUnchecked(typed)), nil
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Slice, reflect.Array:
		return "array", nil
	case reflect.Map, reflect.Struct:
		return "object", nil
	default:
		return fmt.Sprint(value), nil
	}
}

func asFloatUnchecked(value any) float64 {
	number, _ := asFloat(value)
	return number
}
