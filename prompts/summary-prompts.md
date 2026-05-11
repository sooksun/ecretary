# AI Summary Prompt Templates

## System Prompt

คุณคือเลขานุการประชุมมืออาชีพ มีหน้าที่อ่าน transcript การประชุมภาษาไทย/ไทยปนอังกฤษ แล้วสรุปอย่างเป็นระบบ ห้ามแต่งข้อมูลที่ไม่มีใน transcript หากไม่แน่ใจให้ระบุ confidence ต่ำ และใส่ไว้ใน qualityCheck

ต้องตอบเป็น JSON ตาม schema เท่านั้น

## General Meeting Prompt

```txt
สรุปการประชุมต่อไปนี้เป็น JSON โดยแยก:
1. executiveSummary
2. keyPoints
3. decisions
4. actionItems
5. risks
6. pendingQuestions
7. officialMinutes
8. qualityCheck

บริบทการประชุม:
ชื่อประชุม: {{title}}
ประเภทประชุม: {{meetingType}}
วาระ: {{agenda}}
ผู้เข้าร่วม: {{participants}}
Markers: {{markers}}

Transcript:
{{transcript}}

กติกา:
- อย่าสร้างชื่อผู้รับผิดชอบเองถ้า transcript ไม่ระบุ
- ถ้าไม่พบกำหนดส่ง ให้ dueDate = null
- ทุก decision/action ควรมี confidence
- ถ้าเป็นข้อมูลไม่ชัด ให้เพิ่มใน qualityCheck.uncertainItems
```

## PLC Meeting Prompt

```txt
นี่คือ transcript การประชุม PLC ให้สรุปโดยเน้น:
- ปัญหาการเรียนรู้ของผู้เรียน
- หลักฐานที่นำมาคุย
- วิธีการสอน/แนวทางแก้
- ข้อสะท้อนจากเพื่อนครู
- แผนปรับการสอน
- งานติดตามและหลักฐานที่ต้องเก็บ

ตอบเป็น JSON ตาม schema

ข้อมูลประชุม:
{{meetingContext}}

Transcript:
{{transcript}}
```

## Official School Minutes Prompt

```txt
ให้จัดทำข้อมูลรายงานการประชุมแบบราชการไทยจาก transcript ต่อไปนี้

ต้องแยกเป็น:
- เรื่อง
- วัน เวลา สถานที่
- ผู้มาประชุม
- ผู้ไม่มาประชุม
- ผู้เข้าร่วมประชุม
- ระเบียบวาระ
- สาระการอภิปราย
- มติที่ประชุม
- งานที่มอบหมาย
- เวลาเลิกประชุม
- ผู้จดรายงานการประชุม
- ผู้ตรวจรายงานการประชุม

หากข้อมูลใดไม่มีใน transcript ให้ใส่ null หรือ [] และแจ้งใน qualityCheck.missingFields

Transcript:
{{transcript}}
```
