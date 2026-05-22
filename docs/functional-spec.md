# Functional Specification

## Scope

Roll Production System adalah prototype web untuk execution jumbo roll dengan login, transaksi, report, correction, void, replacement, dan traceability raw material.

## Role

- `operator`: transaksi dan report.
- `supervisor`: transaksi, report, dan future maintain BOM.
- `admin`: semua akses.

Pada prototype, semua role dapat melakukan void transaction dengan NIK employee aktif.

## Execution Jumbo Roll

- PRO optional.
- Production line wajib dipilih.
- Resource otomatis mengikuti production line.
- Shift wajib dipilih.
- Operator mengikuti user login.
- Jumbo roll type wajib aktif.
- BOM yang muncul hanya BOM aktif.
- Satu jumbo roll dapat memiliki satu default BOM aktif dan beberapa BOM alternatif aktif.
- Raw material consumption mendukung multi-batch.
- Toleransi actual quantity per material adalah -5% sampai +10% dari planning quantity.
- Quantity input tidak boleh melebihi stok batch.
- Grade wajib aktif di master grade.
- Satu execution dari UI menghasilkan satu roll result.

## Numbering

Roll number:

```text
[production line] [jumbo roll] [MMY] [grade] [running number]
```

Batch jumbo roll:

```text
10 digit numeric increment, mulai dari 0000000001
```

## Correction

Field yang boleh dikoreksi:

- production date time
- shift
- panjang
- lebar
- berat
- grade
- PRO reference
- notes

Field yang harus memakai void + replacement:

- production line
- resource
- jumbo roll type
- BOM
- raw material batch
- raw material quantity
- roll number
- jumbo batch number

## Void

Void transaction:

- hanya dari status completed.
- wajib reason.
- wajib NIK employee aktif.
- membuat stock movement reversal.
- status menjadi voided.
- nomor roll tidak dipakai ulang.

## Report

Report jumbo roll mendukung global search dan filter:

- tanggal produksi
- production line
- grade
- status
- raw material

Report raw material movement menampilkan consumption dan void reversal.
