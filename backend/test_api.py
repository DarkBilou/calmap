"""Test de fumée de l'API Calmap : appelle les 4 endpoints et vérifie les schémas.

Sans framework de test — juste requests + asserts.

Prérequis : serveur lancé (uvicorn backend.main:app --port 8000), puis :
    python backend/test_api.py [url_base]
"""
from __future__ import annotations

import sys
from typing import Any

import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"

# Points dans la zone de démo (Paris + Issy-les-Moulineaux)
DEPART = {"lat": 48.8610, "lon": 2.3430}
ARRIVEE = {"lat": 48.8645, "lon": 2.3490}


def _get(chemin: str, **params: Any) -> requests.Response:
    return requests.get(f"{BASE}{chemin}", params=params, timeout=60)


def _verifier_feature_linestring(geojson: dict) -> None:
    assert geojson["type"] == "Feature", geojson
    assert geojson["geometry"]["type"] == "LineString"
    coords = geojson["geometry"]["coordinates"]
    assert len(coords) >= 2 and len(coords[0]) == 2  # [[lon, lat], ...]


def test_health() -> None:
    r = _get("/api/health")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "ok"
    assert d["graph_loaded"] is True
    assert isinstance(d["edges"], int) and d["edges"] > 0
    assert d["bruit_source"] in ("reel", "synthetique")


def test_route() -> None:
    r = _get("/api/route", from_lat=DEPART["lat"], from_lon=DEPART["lon"],
             to_lat=ARRIVEE["lat"], to_lon=ARRIVEE["lon"],
             heure=18, poids_bruit=0.7, poids_foule=0.5, beta=3.0)
    assert r.status_code == 200, r.text
    d = r.json()
    for cle in ("rapide", "calme", "confiance"):
        assert cle in d, f"clé manquante : {cle}"
    for iti in (d["rapide"], d["calme"]):
        _verifier_feature_linestring(iti["geojson"])
        assert iti["distance_m"] > 0
        assert iti["duree_min"] > 0
        assert iti["exposition"] >= 0
    assert "delta_duree_min" in d["calme"]
    assert "delta_exposition_pct" in d["calme"]
    assert 0.0 <= d["confiance"] <= 1.0
    # l'itinéraire calme ne peut pas être plus court que le rapide
    assert d["calme"]["distance_m"] >= d["rapide"]["distance_m"]


def test_heatmap() -> None:
    r = _get("/api/heatmap", heure=18, poids_bruit=0.7, poids_foule=0.5,
             sud=48.858, nord=48.866, ouest=2.340, est=2.352)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["type"] == "FeatureCollection"
    features = d["features"]
    assert len(features) > 0, f"{len(features)} features"
    proprietes = features[0]["properties"]
    assert 0.0 <= proprietes["score"] <= 1.0
    assert "lden" in proprietes
    assert features[0]["geometry"]["type"] == "LineString"


def test_quand() -> None:
    r = _get("/api/quand", lat=48.8620, lon=2.3450, poids_bruit=0.7, poids_foule=0.5)
    assert r.status_code == 200, r.text
    d = r.json()
    scores = d["scores_horaires"]
    assert len(scores) == 24
    assert [s["heure"] for s in scores] == list(range(24))
    assert all(0.0 <= s["score"] <= 1.0 for s in scores)
    creneau = d["creneau_optimal"]
    assert 8 <= creneau["debut"] <= 19
    assert creneau["fin"] == creneau["debut"] + 2
    assert creneau["fin"] <= 21


def test_erreurs() -> None:
    # coordonnées hors de la zone de démo → 400 avec {"detail": ...}
    r = _get("/api/route", from_lat=48.99, from_lon=2.3430,
             to_lat=ARRIVEE["lat"], to_lon=ARRIVEE["lon"])
    assert r.status_code == 400, r.text
    assert "detail" in r.json()
    # heure invalide → 400
    r = _get("/api/heatmap", heure=99)
    assert r.status_code == 400, r.text
    # paramètre non parsable → 400 (pas 422, pas de crash)
    r = _get("/api/heatmap", heure="abc")
    assert r.status_code == 400, r.text


if __name__ == "__main__":
    try:
        requests.get(f"{BASE}/api/health", timeout=5)
    except requests.ConnectionError:
        sys.exit(f"❌ Serveur injoignable sur {BASE} — lancez d'abord :\n"
                 "   uvicorn backend.main:app --port 8000")

    tests = [test_health, test_route, test_heatmap, test_quand, test_erreurs]
    for test in tests:
        test()
        print(f"✅ {test.__name__}")
    print("\n🎉 Tous les tests passent : le contrat d'API est respecté.")
