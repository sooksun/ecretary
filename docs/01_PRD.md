# 01 PRD — M-Secretary V1.3

## Product Name

M-Secretary V1.3 — Mobile AI Meeting Secretary

## Vision

สร้างแอปมือถือที่เปลี่ยนมือถือเครื่องเก่าให้เป็นเลขานุการประชุมดิจิทัล สามารถบันทึกเสียง ถอดเสียง สรุปมติ จับงานติดตาม และสร้างรายงานประชุมได้ โดยใช้ทรัพยากรน้อยและเหมาะกับบริบทโรงเรียน/หน่วยงานราชการ

## Problem

การประชุมจำนวนมากมีปัญหาซ้ำ ๆ ได้แก่

- จดบันทึกไม่ครบ
- มติและงานติดตามตกหล่น
- รายงานประชุมล่าช้า
- ไฟล์เสียงกระจัดกระจาย
- ประชุมครั้งต่อไปจำงานค้างไม่ได้
- เจ้าหน้าที่ธุรการและครูเสียเวลาทำเอกสารซ้ำ

## Target Users

- ผู้บริหารโรงเรียน
- ครูฝ่ายวิชาการ
- เจ้าหน้าที่ธุรการ
- หัวหน้าโครงการ
- ทีม PLC
- คณะกรรมการสถานศึกษา
- ทีมติดตามหนุนเสริม/เขตพื้นที่

## Core Value Proposition

กดเริ่มประชุมครั้งเดียว แล้วได้ผลลัพธ์หลัก 5 อย่าง

1. ไฟล์เสียงประชุม
2. Transcript ภาษาไทย
3. สรุปประชุม
4. มติและงานติดตาม
5. รายงานประชุมแบบเป็นทางการ

## MVP Scope

### In Scope

- สร้างรายการประชุม
- บันทึกเสียงแบบ chunk ทุก 5 นาที
- เก็บไฟล์และ metadata แบบ offline-first
- upload queue พร้อม retry
- แสดง recording health
- เพิ่ม live markers ระหว่างประชุม
- backend รับไฟล์เสียง
- transcription job queue
- summary job queue
- meeting board
- action items
- export-ready data structure

### Out of Scope for MVP

- Speaker diarization แบบสมบูรณ์
- ถอดเสียงบนมือถือแบบ offline
- AI real-time streaming transcription
- Multi-tenant billing
- E-signature
- Full LINE Bot workflow

## Key User Stories

### US-01 Create Meeting

ในฐานะผู้ใช้ ฉันต้องการสร้างรายการประชุมพร้อมประเภทประชุม วาระ และผู้เข้าร่วม เพื่อให้ AI สรุปตามบริบทได้แม่นยำ

### US-02 Record Meeting

ในฐานะผู้ใช้ ฉันต้องการกดเริ่มบันทึกเสียง และเห็นสถานะว่าเสียงเข้า แบตเตอรี่ พื้นที่ และเน็ตยังปกติ

### US-03 Protect Audio

ในฐานะผู้ใช้ ฉันต้องการให้ไฟล์เสียงไม่หายแม้เน็ตหลุดหรือแอปปิดผิดพลาด

### US-04 Add Marker

ในฐานะผู้ใช้ ฉันต้องการแตะปุ่ม มติ/งาน/ปัญหา/คำถาม ระหว่างประชุม เพื่อช่วยให้ระบบสรุปช่วงสำคัญได้ดีขึ้น

### US-05 Generate Summary

ในฐานะผู้ใช้ ฉันต้องการให้ระบบสรุปประชุม แยกประเด็น มติ งานติดตาม และความเสี่ยง

### US-06 Follow-up Action

ในฐานะผู้ใช้ ฉันต้องการเห็นงานที่ต้องทำ ผู้รับผิดชอบ กำหนดส่ง และสถานะ

## Functional Requirements

### FR-01 Meeting Management

- Create meeting
- Edit meeting metadata
- Add participants
- Add agenda
- Set meeting type
- Track status

### FR-02 Audio Recording

- Record M4A/AAC
- Split every 5 minutes
- Store locally
- Save checksum
- Save chunk sequence
- Resume next chunk if failure

### FR-03 Upload Queue

- Queue chunks for upload
- Retry failed upload
- Resume upload when online
- Validate checksum after upload
- Show upload progress

### FR-04 AI Processing

- Transcribe each chunk
- Merge transcripts by timestamp
- Clean filler words optionally
- Generate summary
- Extract decisions
- Extract action items
- Extract risks
- Extract pending questions

### FR-05 Meeting Board

- Executive Summary
- Key Points
- Decisions
- Action Items
- Risks / Issues
- Pending Questions
- Export section

### FR-06 Export

- Prepare official meeting minutes data
- Generate PDF/DOCX in later sprint
- Allow share file/link

## Non-functional Requirements

- Android-first
- Low battery usage
- Offline-first
- Data recoverable after crash
- Upload retry must be idempotent
- Server process must be queue-based
- Thai language first
- Privacy and consent notice before recording
- Support old Android phones where practical

## Success Metrics

- Audio loss rate < 1%
- Upload retry success > 95%
- 60-minute meeting processed without mobile crash
- Summary generated within acceptable time after upload
- User can export usable report with minimal editing

## Product Principle

มือถือคือหูและสมุดจด ส่วน Server คือสมอง อย่าให้มือถือแก่ ๆ ไปยกน้ำหนักเหมือนนักเพาะกายวัยเกษียณ
