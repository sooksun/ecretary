# 09 Security, Privacy, and Consent

## Core Principle

Meeting audio may contain personal data, student information, personnel discussions, or confidential school matters. Treat every recording as sensitive.

## Consent UX

Before recording:

- show consent notice
- show purpose of recording
- show who can access output
- require user confirmation

Suggested notice:

```txt
ระบบนี้จะบันทึกเสียงการประชุมเพื่อถอดเสียงและจัดทำสรุปรายงานประชุม กรุณาแจ้งผู้เข้าร่วมประชุมให้ทราบก่อนเริ่มบันทึกเสียง
```

## Access Control

Roles:

- admin: manage organization/settings
- recorder: create meetings and upload audio
- editor: edit summaries/action items
- viewer: view final reports

## Data Security

- HTTPS only
- JWT auth
- signed upload/download URLs where possible
- object storage private by default
- audit logs for export/download/delete
- encrypt secrets using environment variables

## Retention Policy

Configurable:

- keep local audio until uploaded
- auto-delete local chunks after successful backup and user confirmation
- server audio retention: 30/90/365 days based on policy
- transcript/report retention according to organization rules

## Sensitive Data Warnings

AI output must include review requirement:

```txt
ผลสรุปจาก AI ควรได้รับการตรวจทานจากผู้รับผิดชอบก่อนใช้เป็นเอกสารทางราชการ
```

## Data Deletion

Required features:

- delete meeting audio
- delete transcript
- delete generated report
- export before delete
- admin-only permanent deletion

## Logging

Do not log:

- raw transcript
- audio URLs
- private tokens
- personally sensitive content

Can log:

- job id
- status
- duration
- error code
- processing time
