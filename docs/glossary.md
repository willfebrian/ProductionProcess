# Roll Production System Glossary

## Istilah Umum

- **Roll Production System**: aplikasi pencatatan execution produksi roll dan traceability raw material.
- **Execution Jumbo Roll**: transaksi pencatatan hasil produksi satu jumbo roll. Satu execution menghasilkan satu roll result.
- **Process Order / PRO**: referensi rencana proses produksi. Pada prototype bersifat opsional.
- **Production Line**: line produksi dengan kode alphanumeric 1-2 karakter. Kode ini menjadi bagian nomor roll.
- **Resource**: mesin/resource produksi yang terhubung dengan production line. Saat ini relasinya 1 production line = 1 resource.
- **Shift**: periode kerja produksi, misalnya S1, S2, S3.

## Master Data

- **User**: akun login aplikasi dengan role operator, supervisor, atau admin.
- **Employee**: master karyawan yang dipakai untuk validasi NIK konfirmasi, correction, dan void.
- **Jumbo Roll Type**: tipe jumbo roll yang akan diproduksi, misalnya P12, B20, A07.
- **BOM / Bill of Material**: daftar raw material dan quantity planning untuk satu tipe jumbo roll.
- **BOM Version**: versi BOM dengan format `BOM-[kode jumbo roll]-V[2 digit]`, misalnya `BOM-P12-V01`.
- **Default BOM**: BOM aktif utama untuk satu jumbo roll. User masih dapat memilih BOM alternatif aktif.
- **Grade**: kode kualitas hasil produksi 2 digit alphanumeric, divalidasi ke master grade.
- **Raw Material Batch**: batch stok raw material yang memiliki material code, status, dan available quantity.

## Numbering

- **Roll Number**: nomor identitas roll yang terbentuk saat execution berhasil. Format:
  `[production line] [jumbo roll] [MMY] [grade] [running number]`
- **MMY**: 2 digit bulan dan 1 digit terakhir tahun produksi. Contoh Mei 2026 menjadi `056`.
- **Running Number**: nomor urut 3 digit per kombinasi production line + jumbo roll + MMY. Nomor void tetap dihitung.
- **Jumbo Batch Number**: nomor batch jumbo roll 10 digit numeric increment, dimulai dari `0000000001`.

## Quantity & Output

- **Planning Qty**: quantity raw material dari BOM dalam KG.
- **Actual Qty**: quantity raw material aktual yang diinput operator dalam KG.
- **Tolerance**: batas aktual raw material per material line, yaitu -5% sampai +10% dari planning qty.
- **Output Status**: status hasil roll. Pada prototype saat ini execution dari UI otomatis disimpan sebagai GOOD.

## Transaction Lifecycle

- **Completed**: status transaksi sukses.
- **Correct Transaction**: koreksi field tertentu tanpa mengubah nomor roll dan tanpa mengubah material consumption.
- **Void Transaction**: pembatalan transaksi completed. Void membuat reversal stock movement dan nomor roll tidak dipakai ulang.
- **Replacement Transaction**: transaksi baru sebagai pengganti transaksi voided. Replacement mendapat nomor roll baru.
- **Revision**: angka versi koreksi transaksi.
- **Correction History**: audit before/after dari correction.

## Stock Movement

- **Stock Movement Ledger**: histori mutasi stok raw material.
- **Production Consumption**: movement negatif saat raw material dipakai execution.
- **Void Reversal**: movement positif saat transaksi di-void.
- **Before Qty / After Qty**: stok batch sebelum dan sesudah movement.

## Variable Name Utama

- `rollNumber`: nomor roll hasil produksi.
- `jumboBatchNumber`: batch jumbo roll 10 digit.
- `processOrderNumber` / `proNumber`: nomor PRO.
- `productionLineCode`: kode production line.
- `resourceCode`: kode resource.
- `shiftCode`: kode shift.
- `jumboRollCode`: kode tipe jumbo roll.
- `bomCode`: kode BOM version.
- `gradeCode`: kode grade.
- `actualLengthM`: panjang aktual dalam meter.
- `actualWidthMm`: lebar aktual dalam mm.
- `actualWeightKg`: berat aktual dalam KG.
- `rawMaterialConsumptions`: daftar pemakaian raw material per material dan batch.
- `stockMovements`: daftar mutasi stok.
