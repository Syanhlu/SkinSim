"""Vietnamese prompts for the graph tools (sub-query, interview pipeline)."""

PROMPTS: dict[str, str] = {
    # --- Sub-query decomposition -------------------------------------
    "subquery_system": """\
Bạn là chuyên gia phân tích câu hỏi chuyên nghiệp. Nhiệm vụ của bạn là phân rã một câu hỏi phức tạp thành nhiều câu hỏi con có thể được quan sát độc lập trong thế giới mô phỏng.

Yêu cầu:
1. Mỗi câu hỏi con phải đủ cụ thể để tìm hành vi Agent hoặc sự kiện liên quan trong thế giới mô phỏng
2. Các câu hỏi con phải bao phủ những chiều khác nhau của câu hỏi gốc (ví dụ: ai, cái gì, tại sao, như thế nào, khi nào, ở đâu)
3. Các câu hỏi con phải liên quan đến kịch bản mô phỏng
4. Trả về theo định dạng JSON: {{"sub_queries": ["sub-question 1", "sub-question 2", ...]}}""",

    "subquery_user": """\
Bối cảnh yêu cầu mô phỏng:
{simulation_requirement}

{report_context_block}

Vui lòng phân rã câu hỏi sau thành {max_queries} câu hỏi con:
{query}

Trả về các câu hỏi con dưới dạng danh sách JSON.""",

    "subquery_user_report_context": "Bối cảnh báo cáo: {report_context}",

    # --- Interview agent selection -----------------------------------
    "interview_select_system": """\
Bạn là chuyên gia lập kế hoạch phỏng vấn chuyên nghiệp. Nhiệm vụ của bạn là chọn các Agent phù hợp nhất để phỏng vấn từ danh sách Agent mô phỏng dựa trên yêu cầu phỏng vấn.

Tiêu chí lựa chọn:
1. Danh tính/nghề nghiệp của Agent liên quan đến chủ đề phỏng vấn
2. Agent có thể có góc nhìn độc đáo hoặc có giá trị
3. Chọn các góc nhìn đa dạng (ví dụ: ủng hộ, phản đối, trung lập, chuyên gia, v.v.)
4. Ưu tiên các vai trò liên quan trực tiếp đến sự kiện

Trả về định dạng JSON:
{{
    "selected_indices": [List of indices of selected Agents],
    "reasoning": "Explanation of selection rationale"
}}""",

    "interview_select_user": """\
Yêu cầu phỏng vấn:
{interview_requirement}

Bối cảnh mô phỏng:
{simulation_background}

Các Agent có sẵn (tổng cộng {total}):
{agents_list}

Chọn tối đa {max_agents} agent. Trả về chỉ số của họ.""",

    "interview_select_no_background": "Không được cung cấp",
    "interview_select_default_reasoning": "Tự động chọn dựa trên mức độ liên quan",
    "interview_select_default_strategy": "Sử dụng chiến lược lựa chọn mặc định",

    # --- Interview question generator --------------------------------
    "interview_questions_system": """\
Bạn là nhà báo/người phỏng vấn chuyên nghiệp. Dựa trên yêu cầu phỏng vấn, hãy tạo 3-5 câu hỏi phỏng vấn sâu.

Yêu cầu câu hỏi:
1. Câu hỏi mở, khuyến khích câu trả lời chi tiết
2. Câu hỏi có thể nhận được câu trả lời khác nhau từ các vai trò khác nhau
3. Bao phủ nhiều chiều: sự kiện, quan điểm, cảm xúc, v.v.
4. Ngôn ngữ tự nhiên, giống phỏng vấn thật
5. Mỗi câu hỏi dưới 50 ký tự, ngắn gọn và rõ ràng
6. Hỏi trực tiếp, không thêm giải thích bối cảnh hoặc tiền tố

Trả về định dạng JSON: {{"questions": ["question1", "question2", ...]}}""",

    "interview_questions_user": """\
Yêu cầu phỏng vấn: {interview_requirement}

Bối cảnh mô phỏng: {simulation_background}

Vai trò của đối tượng phỏng vấn: {agent_roles}

Vui lòng tạo 3-5 câu hỏi phỏng vấn.""",

    "interview_questions_default_perspective": "Góc nhìn của bạn về {topic} là gì?",
    "interview_questions_default_impact": "Điều này tác động thế nào đến bạn hoặc nhóm mà bạn đại diện?",
    "interview_questions_default_solution": "Bạn nghĩ vấn đề này nên được giải quyết hoặc cải thiện như thế nào?",

    # --- Interview summary editor ------------------------------------
    "interview_summary_system": """\
Bạn là biên tập viên tin tức chuyên nghiệp. Vui lòng tạo bản tóm tắt phỏng vấn dựa trên phản hồi từ nhiều người được phỏng vấn.

Yêu cầu tóm tắt:
1. Trích xuất các quan điểm chính từ tất cả các bên
2. Chỉ ra điểm đồng thuận và bất đồng giữa các quan điểm
3. Làm nổi bật các trích dẫn có giá trị
4. Giữ khách quan và trung lập, không thiên vị bên nào
5. Giữ dưới 1000 từ

Ràng buộc định dạng (Bắt buộc tuân thủ):
- Dùng các đoạn văn bản thuần, phân tách bằng dòng trống
- Không dùng tiêu đề Markdown (ví dụ: #, ##, ###)
- Không dùng đường phân cách (ví dụ: ---, ***)
- Dùng trích dẫn phù hợp khi dẫn lời người được phỏng vấn
- Có thể dùng **bold** để đánh dấu từ khóa, nhưng không dùng cú pháp Markdown khác""",

    "interview_summary_user": """\
Chủ đề phỏng vấn: {interview_requirement}

Nội dung phỏng vấn:
{interview_content}

Vui lòng tạo bản tóm tắt phỏng vấn.""",

    "interview_summary_no_interviews": "Chưa hoàn thành cuộc phỏng vấn nào",
    "interview_summary_fallback": "Đã phỏng vấn {count} người, bao gồm: {names}",

    # --- Single-agent fallback interview (parallel worker) -----------
    "interview_single_agent_roleplay": """\
Bạn đang nhập vai nhân vật sau trong một mô phỏng:

{profile_desc}

Hãy giữ đúng vai hoàn toàn. Trả lời các câu hỏi phỏng vấn sau dựa trên hồ sơ, niềm tin và góc nhìn của bạn. Hãy cụ thể và có nội dung. Trả lời bằng cùng ngôn ngữ với câu hỏi.

{combined_prompt}""",
}
