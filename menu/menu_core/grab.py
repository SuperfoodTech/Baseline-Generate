def extract_grab_menu(store_metadata: dict, output_dir: str):
    """Stub for GrabFood menu extraction."""
    store_id = store_metadata['store_id']
    nama_resto = store_metadata['nama_resto_final'] or store_metadata['nama_outlet']
    print(f"\n[GrabFood Menu Extractor] (Stub)")
    print(f"[-] Target Outlet: {nama_resto} ({store_id})")
    print(f"[!] Penarikan menu untuk GrabFood belum diimplementasikan / masih dalam pengembangan.")
    print(f"[!] GrabFood membutuhkan integrasi token Partner API atau session parsing.")
    return False, "Penarikan menu untuk GrabFood belum diimplementasikan."
