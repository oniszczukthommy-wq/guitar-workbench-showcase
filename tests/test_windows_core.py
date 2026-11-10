from fastapi.testclient import TestClient
from backend.server import app


def test_core_works_without_optional_models():
    with TestClient(app) as client:
        assert client.get('/').status_code == 200
        assert client.get('/api/health').json()['status'] == 'ok'
        songs = client.get('/api/songs').json()
        assert len(songs) >= 3
        engines = client.get('/api/health').json()['engines']
        assert all(isinstance(engine['available'], bool) for engine in engines)
