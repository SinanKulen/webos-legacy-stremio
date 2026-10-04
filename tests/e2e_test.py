"""
End-to-end UI test with mocked Stremio / TMDB / OMDb APIs.

Runs the app in headless Chromium (Playwright), drives it with the keyboard like a TV remote
and prints what it sees. Screenshots are written to tests/out/.

    pip install playwright && playwright install chromium
    python tests/e2e_test.py

Note: this checks app logic and layout only. Real playback on webOS 3.x (Chromium 38) must be
tested on a TV. Run scripts/check_es5.js to make sure no ES2015+ syntax slipped in.
"""
import json, asyncio, re
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright
import os, base64
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP='file://'+os.path.join(ROOT,'app','index.html')
OUT=os.path.join(ROOT,'tests','out'); os.makedirs(OUT, exist_ok=True)
# 1x1 PNG placeholder for all images
POSTER=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqP9fDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
def man(id,name,res,types,catalogs=[],prefixes=['tt']):
    return {"transportUrl":f"https://{id}.example/manifest.json","manifest":{"id":id,"name":name,"resources":res,"types":types,"catalogs":catalogs,"idPrefixes":prefixes}}
ADDONS=[
 {"transportUrl":"https://v3-cinemeta.strem.io/manifest.json","manifest":{"id":"com.linvo.cinemeta","name":"Cinemeta","resources":["catalog","meta"],"types":["movie","series"],"idPrefixes":["tt"],"catalogs":[{"type":"movie","id":"top","name":"Popular","extra":[{"name":"search"}]}]}},
 man('aio','AIOStreams',[{"name":"stream","types":["movie","series"],"idPrefixes":["tt","tmdb:"]}],['movie','series']),
 man('subs','OpenSubtitles v3',['subtitles'],['movie','series']),
]
calls=[]
def tmdb_list(kind, page):
    base = 1000 if kind=='movie' else 5000
    res=[]
    for i in range(20):
        n=base+(page-1)*20+i
        r={"id":n,"poster_path":"/p.png","vote_average":7.3}
        if kind=='movie': r.update(title=f"Türkçe Film {n}")
        else: r.update(name=f"Türk Dizisi {n}")
        res.append(r)
    return {"page":page,"total_pages":50,"total_results":1000,"results":res}
def tmdb(path, q):
    page=int(q.get('page',['1'])[0])
    if path.startswith('/3/find/'): return {"movie_results":[{"id":1001}],"tv_results":[{"id":5001}]}
    if re.match(r'^/3/tv/\d+/season/\d+$',path):
        s=int(path.split('/')[-1]); return {"episodes":[{"episode_number":e,"name":f"Türkçe Bölüm Adı {e}","overview":"Bu bölümde olaylar gelişiyor.","air_date":"2020-01-0%d"%e,"runtime":45} for e in range(1,9)]}
    if path.startswith('/3/person/'):
        return {"id":7,"name":"Morgan Freeman","known_for_department":"Acting","birthday":"1937-06-01","place_of_birth":"Memphis, Tennessee, USA","biography":"Amerikalı oyuncu ve anlatıcı.","profile_path":"/f.png",
          "combined_credits":{"cast":[{"id":100+i,"media_type":"movie" if i%3 else "tv","title":f"Film {i}","name":f"Dizi {i}","poster_path":"/p.png","popularity":50-i,"character":"Rol"} for i in range(15)],"crew":[]}}
    if re.match(r'^/3/movie/\d+$',path):
        return {"images":{"logos":[{"iso_639_1":"en","file_path":"/logo.png"}]},"recommendations":{"results":[{"id":2000+i,"title":f"Benzer {i}","poster_path":"/p.png","vote_average":7.1,"media_type":"movie"} for i in range(12)]},
         "id":1001,"imdb_id":"tt0111161","title":"Esaretin Bedeli","original_title":"The Shawshank Redemption","overview":"İki mahkum yıllar içinde bağ kurar ve sıradan iyilik eylemleriyle kurtuluşu bulur.","tagline":"Korku seni esir tutar. Umut seni özgür bırakır.","poster_path":"/p.png","backdrop_path":"/b.png","release_date":"1994-09-23","runtime":142,"vote_average":8.7,"vote_count":28000,"genres":[{"name":"Dram"},{"name":"Suç"}],"credits":{"cast":[{"id":7,"name":"Morgan Freeman","character":"Red","profile_path":"/f.png"},{"id":8,"name":"Tim Robbins","character":"Andy Dufresne","profile_path":"/f.png"}],"crew":[{"job":"Director","name":"Frank Darabont"},{"job":"Screenplay","name":"Frank Darabont"},{"job":"Original Music Composer","name":"Thomas Newman"}]}}
    if re.match(r'^/3/tv/\d+$',path):
        return {"id":5001,"name":"Kuruluş Osman","original_name":"Kuruluş: Osman","overview":"Osman Bey'in hikayesi.","poster_path":"/p.png","backdrop_path":"/b.png","first_air_date":"2019-11-20","status":"Returning Series","episode_run_time":[140],"vote_average":7.9,"number_of_seasons":2,"genres":[{"name":"Dram"}],"external_ids":{"imdb_id":"tt11212276"},"created_by":[{"name":"Mehmet Bozdağ"}],"credits":{"cast":[{"name":"Burak Özçivit"}],"crew":[]},
                "seasons":[{"season_number":0,"episode_count":2},{"season_number":1,"episode_count":8},{"season_number":2,"episode_count":8}]}
    kind='tv' if '/tv' in path else 'movie'
    calls.append(path+' p'+str(page))
    return tmdb_list(kind,page)
STREAMS={"streams":[
 {"name":"[RD+] AIO 1080p","title":"Film.1080p.WEB-DL.x264.AAC.mp4\n💾 2.3 GB","url":"https://rd.example/c.mp4"},
 {"name":"[RD+] AIO 1080p 🇹🇷","title":"Film.1080p.TR-EN.Dual.x264.AC3.mkv\n💾 3.1 GB","url":"https://rd.example/tr.mkv"},
 {"name":"[RD+] AIO 4K","title":"Movie.2160p.HDR.x265.mkv\n💾 25 GB","url":"https://rd.example/a.mkv"},
]}
async def handle(route):
    u=route.request.url; pu=urlparse(u); q=parse_qs(pu.query)
    def j(o): return route.fulfill(status=200,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(o))
    if 'api.themoviedb.org' in u: return await j(tmdb(pu.path,q))
    if 'omdbapi.com' in u: return await j({"Response":"True","imdbRating":"9.3","imdbVotes":"2,950,123","Metascore":"82","Awards":"Nominated for 7 Oscars. 21 wins & 43 nominations total","Ratings":[{"Source":"Internet Movie Database","Value":"9.3/10"},{"Source":"Rotten Tomatoes","Value":"89%"},{"Source":"Metacritic","Value":"82/100"}]})
    if 'image.tmdb.org' in u or 'img.example' in u: return await route.fulfill(status=200,content_type='image/png',body=POSTER)
    if 'api.strem.io/api/login' in u: return await j({"result":{"authKey":"KEY"}})
    if 'addonCollectionGet' in u: return await j({"result":{"addons":ADDONS}})
    if 'datastoreGet' in u: return await j({"result":[{"_id":"tt0111161","type":"movie","name":"The Shawshank Redemption","poster":"https://img.example/x.png","removed":False,"temp":False,"_mtime":"2026-10-01T00:00:00Z","state":{"timeOffset":3000000,"duration":6000000}}]})
    if '/stream/' in u: return await j(STREAMS)
    if '/subtitles/' in u: return await j({"subtitles":[{"id":"1","url":"https://sub.example/1.srt","lang":"eng"},{"id":"2","url":"https://sub.example/2.srt","lang":"tur"}]})
    if 'sub.example' in u: return await route.fulfill(status=200,headers={'Access-Control-Allow-Origin':'*'},body="1\n00:00:01,000 --> 00:00:04,000\nMerhaba\n".encode('cp1254'))
    return await route.fulfill(status=404,body='')
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--allow-file-access-from-files','--disable-web-security'])
        pg=await b.new_page(viewport={'width':1920,'height':1080})
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.route('**/*',lambda r: asyncio.ensure_future(handle(r)) if not r.request.url.startswith('file:') else asyncio.ensure_future(r.continue_()))
        await pg.goto(APP); await pg.wait_for_timeout(200)
        # seed a half-watched episode for "continue watching"
        await pg.evaluate("""localStorage.setItem('progress', JSON.stringify({'tt11212276:1:3':{t:1200,d:2700,ts:Date.now(),info:{metaId:'tt11212276',type:'series',tmdbId:5001,name:'Kuruluş Osman',poster:'https://image.tmdb.org/t/p/w185/p.png',label:'S1B3'}}}))""")
        # fake API keys so the TMDB/OMDb code paths run against the mocks even without app/config.js
        await pg.evaluate("localStorage.setItem('tmdbKey', JSON.stringify('test')); localStorage.setItem('omdbKey', JSON.stringify('test'))")
        await pg.reload(); await pg.wait_for_timeout(300)
        k=pg.keyboard
        async def press(*keys, wait=150):
            for key in keys: await k.press(key); await pg.wait_for_timeout(wait)
        act=lambda: pg.evaluate("document.querySelector('.screen.active').id")
        foc=lambda: pg.evaluate("(window.__ls.focused()||{}).textContent")
        await press('Enter'); await k.type('a@b.com'); await press('Enter','Enter'); await k.type('pw'); await press('Enter','Enter')
        await pg.wait_for_timeout(1500)
        rows = await pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#home-rows .row-title'),function(e){return e.textContent})")
        print('home rows:', rows[:5])
        await pg.screenshot(path=os.path.join(OUT,'v3_1_home.png'))
        # go to Filmler tab
        await press('ArrowUp','ArrowUp','ArrowUp','ArrowRight','Enter', wait=250); await pg.wait_for_timeout(1000)
        print('screen', await act(), 'focus', await foc())
        await press('Enter', wait=300); await pg.wait_for_timeout(1000)
        await pg.screenshot(path=os.path.join(OUT,'v3_2_detail.png'))
        print('ratings:', await pg.inner_text('#detail-ratings'))
        print('crew:', await pg.inner_text('#detail-crew'))
        print('actions:', await pg.inner_text('#detail-actions'))
        await press('ArrowRight','Enter', wait=300)
        print('after list toggle:', await pg.inner_text('#detail-actions'))
        await press('ArrowDown', wait=400)
        print('focus after down:', await foc())
        await pg.screenshot(path=os.path.join(OUT,'v3_3_detail_cast.png'))
        await press('Enter', wait=300); await pg.wait_for_timeout(800)
        print('person screen:', await act(), await pg.inner_text('#person-name'), '|', await pg.inner_text('#person-meta'))
        print('person rows:', await pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#person-rows .row-title'),function(e){return e.textContent})"))
        await pg.screenshot(path=os.path.join(OUT,'v3_4_person.png'))
        await press('Escape', wait=400)
        print('back to', await act(), 'focus', await foc())
        await press('ArrowDown', wait=400)
        print('similar focus', await foc())
        await press('Escape', wait=300); await press('Escape', wait=300)
        print('now', await act())
        await press('ArrowUp','ArrowUp','ArrowUp','ArrowUp', wait=150)
        print('nav', await foc())
        await press('ArrowLeft','Enter', wait=300); await pg.wait_for_timeout(800)
        rows = await pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#home-rows .row-title'),function(e){return e.textContent})")
        print('home rows after add:', await act(), rows[:4])
        await press('ArrowUp','ArrowUp','ArrowUp', wait=150)
        await press('ArrowRight','ArrowRight','ArrowRight','Enter', wait=250); await pg.wait_for_timeout(800)
        print('mylist:', await act(), await pg.evaluate("Array.prototype.map.call(document.querySelectorAll('#mylist-rows .row-title'),function(e){return e.textContent})"))
        await pg.screenshot(path=os.path.join(OUT,'v3_5_mylist.png'))
        print('errors:', errs)
        await b.close()
if __name__=="__main__": asyncio.run(main())
