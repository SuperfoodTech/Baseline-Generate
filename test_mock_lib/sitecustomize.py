import sys
import io

# Mock urllib.request.urlopen globally at startup
import urllib.request

original_urlopen = urllib.request.urlopen

def mock_urlopen(url, *args, **kwargs):
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
        bio = io.BytesIO(csv_data.encode('utf-8'))
        return urllib.request.addinfourl(bio, {}, url_str)
    elif "565510790" in url_str:
        csv_data = """Username,Password,Phone,BD
auto7307,Auto@7307,6285136517307,bd 7307
"""
        bio = io.BytesIO(csv_data.encode('utf-8'))
        return urllib.request.addinfourl(bio, {}, url_str)
        
    return original_urlopen(url, *args, **kwargs)

urllib.request.urlopen = mock_urlopen
