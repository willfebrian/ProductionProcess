# Transaction Scenarios

## Execution Normal

1. **Normal, 1 material 1 batch**
   - Line `L1`, Shift `S1`, Jumbo Roll `P12`, BOM `BOM-P12-V01`, Grade `A1`.
   - Raw material sesuai planning dan setiap material memakai satu batch.
   - Ekspektasi: transaksi sukses, roll number terbentuk, batch jumbo roll terbentuk, stock movement consumption tersimpan.

2. **Normal, 1 material multi-batch**
   - Material PET planning 100 KG.
   - Input PET-A2401 60 KG dan PET-A2402 42 KG.
   - Total 102 KG masih dalam toleransi 95-110 KG.
   - Ekspektasi: transaksi sukses dan dua movement PET dibuat.

3. **BOM alternatif aktif**
   - Jumbo Roll `P12`, pilih `BOM-P12-V02`.
   - Ekspektasi: material mengikuti BOM V02 dan transaksi dapat dijalankan.

4. **BOM nonaktif tidak muncul**
   - `BOM-P12-V99` berstatus inactive.
   - Ekspektasi: tidak muncul pada dropdown transaksi.

## Validasi Quantity

5. **Quantity di bawah toleransi**
   - Planning 100 KG, input 94 KG.
   - Ekspektasi: error sebelum modal konfirmasi.

6. **Quantity di atas toleransi**
   - Planning 100 KG, input 111 KG.
   - Ekspektasi: error sebelum modal konfirmasi.

7. **Quantity melebihi stok batch**
   - Stok batch 50 KG, input 60 KG.
   - Ekspektasi: error stok tidak cukup.

8. **Salah batch material**
   - Material BOM PET, batch input ADH-E2401.
   - Ekspektasi: error material batch tidak sesuai.

## PRO

9. **Execution dengan PRO released**
   - Pilih `PRO-20260518-001`.
   - Ekspektasi: jumbo roll, line, dan default BOM terisi otomatis.

10. **Over planned quantity**
   - Planned good PRO 3 roll, progress sudah 3 good roll, input good roll ke-4.
   - Ekspektasi: warning, tidak blocking.

## Correction, Void, Replacement

11. **Correct field minor**
   - Koreksi berat dari 500 KG ke 505 KG.
   - Ekspektasi: nomor roll tetap, revision naik, correction history tersimpan.

12. **Material tidak dikoreksi langsung**
   - Salah batch atau quantity raw material.
   - Ekspektasi: gunakan void + replacement.

13. **Void transaction**
   - Void transaksi yang memakai PET-A2401 100 KG.
   - Ekspektasi: status voided, movement reversal +100 KG dibuat, stok batch kembali.

14. **Replacement transaction**
   - Roll 001 voided, transaksi lain sudah membuat 002.
   - Replacement mendapat 003 dan menyimpan reference ke 001.

## Numbering

15. **Running number per line + jumbo roll + MMY**
   - `L1 P12 056 A1 001`
   - `L1 P12 056 B1 002`
   - `A2 P12 056 A1 001`

16. **Manual production date memengaruhi MMY**
   - createdAt 2026-05-18, productionDate 2026-04-30.
   - Ekspektasi: MMY `046`.

17. **Void tidak reuse running number**
   - 001 completed, 002 completed, 001 voided.
   - Ekspektasi: transaksi berikutnya 003.
