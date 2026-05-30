import sys
import os

# To import the REAL requests module without circular importing itself:
# 1. Temporarily pop the mock 'requests' from sys.modules
mock_requests = sys.modules.pop("requests", None)

# 2. Temporarily remove mock directory from sys.path
orig_path = list(sys.path)
mock_dir = os.path.dirname(os.path.abspath(__file__))
sys.path = [p for p in sys.path if os.path.abspath(p) != mock_dir]

# 3. Import the real requests module
import requests as _real_requests

# 4. Restore sys.path and sys.modules
sys.path = orig_path
if mock_requests is not None:
    sys.modules["requests"] = mock_requests

def get(url, *args, **kwargs):
    url_str = str(url)
    if "2PACX-1vQ3tLKBNXDqRgBw0mNhKZFxgvKx-JoiTDzm_s5Ix1cm7O6HCv4IvExOLR2HSRVaXSsx82V348mcr9X4" in url_str:
        csv_data = """Aplikasi,Nama Outlet,Cabang,Nama Pengguna,Kata Sandi,Merchant Name,Status,Email Duck,Email FoodMaster
GoFood,Foodnesia,Tanpa Cabang,broom-giddy-slot@duck.com,Dummy,SuperFood,Live,broom-giddy-slot@duck.com,-
GoFood,WonderFood,Tanpa Cabang,hazy-cherub-kindly@duck.com,Dummy,WonderFood,Live,hazy-cherub-kindly@duck.com,-
GrabFood,Foodnesia,Tanpa Cabang,7307foodnesia,SuperFood@2026,SuperFood,Live,-,-
GrabFood,WonderFood,Tanpa Cabang,7307wonderfood,SuperFood@2026,WonderFood,Live,-,-
GrabFood,Do Eat,Tanpa Cabang,7307doeat,SuperFood@2026,"Gurame Bakar, Do Eat",Live,-,-
ShopeeFood,Foodnesia,Tanpa Cabang,auto7307,Dummy,SuperFood,Live,-,-
ShopeeFood,WonderFood,Tanpa Cabang,auto7307,Dummy,WonderFood,Live,-,-
ShopeeFood,Do Eat,Tanpa Cabang,auto7307,Dummy,"Gurame Bakar, Do Eat",Live,-,-
"""
        response = _real_requests.Response()
        response.status_code = 200
        response._content = csv_data.encode('utf-8')
        return response
    elif "565510790" in url_str:
        csv_data = """Username,Password,Phone,BD
auto7307,Auto@7307,6285136517307,bd 7307
"""
        response = _real_requests.Response()
        response.status_code = 200
        response._content = csv_data.encode('utf-8')
        return response
        
    return _real_requests.get(url, *args, **kwargs)

def post(url, *args, **kwargs):
    return _real_requests.post(url, *args, **kwargs)

def __getattr__(name):
    # Dynamically delegate all other lookups to the real requests module
    return getattr(_real_requests, name)
