"""Vietnamese prompts for the ontology generator."""

PROMPTS: dict[str, str] = {
    "system": """\
Bạn là nhà thiết kế ontology cho đồ thị tri thức của một hệ thống mô phỏng mạng xã hội. Chỉ xuất JSON hợp lệ.

Thực thể đại diện cho các chủ thể ngoài đời thực có thể phát ngôn trên mạng xã hội: cá nhân, công ty, tổ chức, cơ quan chính phủ, cơ quan truyền thông, nhóm vận động. KHÔNG phải khái niệm trừu tượng, chủ đề hoặc quan điểm.

## Output Format

```json
{{
    "entity_types": [
        {{
            "name": "PascalCase name",
            "description": "Brief description (max 100 chars)",
            "attributes": [{{"name": "snake_case", "type": "text", "description": "..."}}],
            "examples": ["Example 1", "Example 2"]
        }}
    ],
    "edge_types": [
        {{
            "name": "UPPER_SNAKE_CASE",
            "description": "Brief description (max 100 chars)",
            "source_targets": [{{"source": "SourceType", "target": "TargetType"}}],
            "attributes": []
        }}
    ],
    "analysis_summary": "Brief analysis of the text content"
}}
```

## Quy tắc loại thực thể (NGHIÊM NGẶT)

- Chính xác 10 loại thực thể
- 8 loại đầu: các loại cụ thể suy ra từ văn bản (ví dụ: Student, Professor, University cho sự kiện học thuật; Company, CEO, Employee cho kinh doanh)
- 2 loại cuối BẮT BUỘC là loại dự phòng: `Person` (bất kỳ cá nhân nào) và `Organization` (bất kỳ tổ chức nào)
- Mỗi loại cần 1-3 thuộc tính. Tên thuộc tính dành riêng (KHÔNG dùng): name, uuid, group_id, created_at, summary. Thay vào đó dùng full_name, title, role, position, v.v.
- Các loại cụ thể phải có ranh giới rõ ràng và không chồng lấn

## Quy tắc loại quan hệ

- 6-10 loại quan hệ phản ánh tương tác trên mạng xã hội
- source_targets phải tham chiếu đến các loại thực thể bạn đã định nghĩa
- Loại tham khảo: WORKS_FOR, STUDIES_AT, AFFILIATED_WITH, REPRESENTS, REGULATES, REPORTS_ON, COMMENTS_ON, RESPONDS_TO, SUPPORTS, OPPOSES, COLLABORATES_WITH, COMPETES_WITH

LƯU Ý: Luôn phát ra định danh ASCII cho các trường `name`. Tên loại phải là định danh Python hợp lệ (thực thể PascalCase, quan hệ UPPER_SNAKE_CASE). Mô tả và ví dụ có thể dùng ngôn ngữ của người dùng.""",

    "user_intro": """\
## Yêu cầu mô phỏng

{simulation_requirement}

## Nội dung tài liệu

{combined_text}
""",

    "user_truncation_note": """

...(Văn bản gốc có {original_length} ký tự, đã trích xuất {max_length} ký tự đầu để phân tích ontology)...""",

    "user_additional_context": """
## Ghi chú bổ sung

{additional_context}
""",

    "user_outro": """
Dựa trên nội dung ở trên, hãy thiết kế các loại thực thể và loại quan hệ phù hợp cho mô phỏng dư luận xã hội.

**Các quy tắc bắt buộc tuân thủ**:
1. Phải xuất đúng 10 loại thực thể
2. 2 loại cuối phải là loại dự phòng: Person (dự phòng cho cá nhân) và Organization (dự phòng cho tổ chức)
3. 8 loại đầu là các loại cụ thể được thiết kế dựa trên nội dung văn bản
4. Tất cả loại thực thể phải là chủ thể ngoài đời thực có thể phát ngôn, không phải khái niệm trừu tượng
5. Tên thuộc tính không được dùng từ dành riêng như name, uuid, group_id, v.v.; thay vào đó dùng full_name, org_name, v.v.
""",
}
