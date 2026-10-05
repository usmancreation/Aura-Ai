from __future__ import annotations

import base64
import os
import re
from pathlib import Path
import streamlit as st
import streamlit.components.v1 as components
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# 1. Streamlit Page Configuration
st.set_page_config(
    page_title="AuraAI | AI Career & Skills Navigator",
    page_icon="✦",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# 2. Complete CSS Reset of Streamlit Outer Shell (Edge-to-Edge, Zero Margins, Zero Double/Triple Scrollbars)
st.markdown("""
<style>
    /* Hide Streamlit default chrome & toolbars completely */
    #MainMenu, header[data-testid="stHeader"], footer, [data-testid="stToolbar"], [data-testid="stDecoration"], [data-testid="stStatusWidget"] {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
    }
    html, body, .stApp, [data-testid="stAppViewContainer"], .main, .block-container, [data-testid="stMainBlockContainer"], section.main {
        margin: 0 !important;
        padding: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        overflow: hidden !important;
        background: #030a1f !important;
    }
    iframe {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        border: none !important;
        display: block !important;
        z-index: 999999 !important;
    }
</style>
""", unsafe_allow_html=True)

# 3. Retrieve GROQ_API_KEY universally from environment or Streamlit Secrets
def _find_groq_api_key() -> str:
    # 1. Direct environment variable
    k = os.getenv("GROQ_API_KEY", "").strip()
    if k and k.startswith("gsk_"):
        return k

    if not hasattr(st, "secrets"):
        return k or ""

    try:
        # Check standard key names
        for name in [
            "GROQ_API_KEY", "groq_api_key", "GROQ_KEY", "groq_key",
            "apiKey", "api_key", "API_KEY", "FIREBASE_API_KEY", "firebase_api_key"
        ]:
            if name in st.secrets:
                val = str(st.secrets[name]).strip()
                if (val.startswith("gsk_") or ("GROQ" in name and len(val) > 15)) and "your_" not in val.lower():
                    return val

        # Check nested sections like [GROQ], [firebase], [groq]
        for sec_name in ["GROQ", "groq", "firebase", "FIREBASE"]:
            if sec_name in st.secrets:
                sec = st.secrets[sec_name]
                for field in ["api_key", "apiKey", "GROQ_API_KEY", "key"]:
                    val = str(getattr(sec, "get", lambda f, d="": d)(field, "")).strip()
                    if (val.startswith("gsk_") or (sec_name.lower() == "groq" and len(val) > 15)) and "your_" not in val.lower():
                        return val

        # Deep scan: scan ALL secrets for any value starting with "gsk_"
        def scan_obj(obj):
            if isinstance(obj, str) and obj.strip().startswith("gsk_"):
                return obj.strip()
            if hasattr(obj, "items"):
                for _, v in obj.items():
                    res = scan_obj(v)
                    if res:
                        return res
            elif isinstance(obj, (list, tuple)):
                for item in obj:
                    res = scan_obj(item)
                    if res:
                        return res
            return None

        found = scan_obj(st.secrets)
        if found:
            return found

        # If any generic apiKey exists and starts with gsk_ or is long enough
        for name in ["apiKey", "api_key", "API_KEY"]:
            if name in st.secrets:
                val = str(st.secrets[name]).strip()
                if len(val) > 20:
                    return val
    except Exception:
        pass

    return k or ""

groq_key = _find_groq_api_key()


def get_unified_html(api_key: str) -> str:
    idx_path = BASE_DIR / "index.html"
    dash_path = BASE_DIR / "dashboard.html"
    auth_js_path = BASE_DIR / "static" / "js" / "aura_auth.js"

    idx_html = idx_path.read_text(encoding="utf-8")
    dash_html = dash_path.read_text(encoding="utf-8")
    auth_js = auth_js_path.read_text(encoding="utf-8") if auth_js_path.exists() else ""

    # Inline Avatar image as Base64 data URI
    av_path = BASE_DIR / "assets" / "aura_avatar.jpg"
    if not av_path.exists():
        av_path = BASE_DIR / "aura_avatar.jpg"

    av_uri = "assets/aura_avatar.jpg"
    if av_path.exists():
        av_uri = "data:image/jpeg;base64," + base64.b64encode(av_path.read_bytes()).decode("ascii")

    idx_html = idx_html.replace("assets/aura_avatar.jpg", av_uri).replace("aura_avatar.jpg", av_uri)
    dash_html = dash_html.replace("assets/aura_avatar.jpg", av_uri).replace("aura_avatar.jpg", av_uri)

    # Extract styles
    idx_styles = "\n".join(re.findall(r"<style>([\s\S]*?)</style>", idx_html))
    dash_styles = "\n".join(re.findall(r"<style>([\s\S]*?)</style>", dash_html))

    # Extract index body
    idx_body_full = re.search(r"<body>([\s\S]*?)</body>", idx_html)
    idx_raw = idx_body_full.group(1) if idx_body_full else idx_html
    idx_body = re.sub(r"<script[\s\S]*?</script>", "", idx_raw)

    # Extract index scripts
    idx_scripts = "\n".join(re.findall(r"<script>([\s\S]*?)</script>", idx_html))

    # Extract dashboard body (preserves all modals and content)
    dash_body_full = re.search(r"<body>([\s\S]*?)</body>", dash_html)
    dash_raw = dash_body_full.group(1) if dash_body_full else dash_html
    dash_body = re.sub(r"<script[\s\S]*?</script>", "", dash_raw)

    # Extract dashboard scripts
    dash_scripts = "\n".join(re.findall(r"<script>([\s\S]*?)</script>", dash_html))

    # SPA routing replacements
    idx_scripts = idx_scripts.replace("window.location.href = 'dashboard.html'", "window.navigateTo('dashboard')")
    dash_scripts = dash_scripts.replace("window.location.href = 'index.html'", "window.navigateTo('home')")
    dash_scripts = dash_scripts.replace("window.location.href = 'signin.html'", "window.navigateTo('home')")
    auth_js = auth_js.replace("window.location.href = 'dashboard.html'", "window.navigateTo('dashboard')")
    auth_js = auth_js.replace("window.location.href = 'index.html'", "window.navigateTo('home')")
    auth_js = auth_js.replace("window.location.href = 'signin.html'", "window.navigateTo('home')")

    dash_body = dash_body.replace('href="index.html"', 'href="javascript:window.navigateTo(\'home\')"')
    idx_body = idx_body.replace('href="dashboard.html"', 'href="javascript:window.navigateTo(\'dashboard\')"')
    auth_js = auth_js.replace('href="dashboard.html"', 'href="javascript:window.navigateTo(\'dashboard\')"')

    unified = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AuraAI | AI Career &amp; Skills Navigator</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
/* Base Viewport Reset */
html, body {{
  margin: 0;
  padding: 0;
  width: 100%;
  min-height: 100%;
  background: #030a1f;
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  color: #f2f6ff;
}}
body.in-public {{
  overflow-x: hidden;
  overflow-y: auto !important;
  height: auto !important;
}}
body.in-dashboard {{
  overflow: hidden !important;
  height: 100vh !important;
}}

{idx_styles}
{dash_styles}
</style>
</head>
<body class="in-public">

<!-- Public Modern Web Page (Home, About, Contact Tabs) -->
<div id="viewPublic" style="display: block;">
{idx_body}
</div>

<!-- AI Agent Dashboard View -->
<div id="viewDashboard" style="display: none; height: 100vh; flex-direction: column; overflow: hidden;">
{dash_body}
</div>

<script>
window.__GROQ_API_KEY__ = "{api_key}";

// Smooth Section Navigation for Home, About, Contact
window.switchTab = function(tabName) {{
  const target = document.getElementById(tabName);
  if (target) {{
    target.scrollIntoView({{ behavior: 'smooth' }});
  }}
  document.querySelectorAll('#nav a.link, footer nav a').forEach(a => {{
    const oc = a.getAttribute('onclick') || '';
    const href = a.getAttribute('href') || '';
    if (oc.includes("'" + tabName + "'") || href === '#' + tabName) {{
      a.classList.add('active');
    }} else {{
      a.classList.remove('active');
    }}
  }});
}};

// Seamless Page Routing between Public Site & Dashboard
window.navigateTo = function(target) {{
    const pub = document.getElementById('viewPublic');
    const dash = document.getElementById('viewDashboard');

    if (target === 'dashboard') {{
        // If modal was open, close it
        if (typeof closeModal === 'function') {{
            closeModal();
        }} else {{
            const ov = document.getElementById('overlay');
            if (ov) {{
                ov.classList.remove('show');
                ov.setAttribute('aria-hidden', 'true');
            }}
        }}
        document.body.style.overflow = '';

        if (pub) pub.style.display = 'none';
        if (dash) {{
            dash.style.display = 'flex';
            dash.style.flexDirection = 'column';
            dash.style.height = '100vh';
            dash.style.overflow = 'hidden';
        }}
        document.body.className = 'in-dashboard';
        window.scrollTo(0, 0);

        // Update dashboard user name
        const u = (window.AuraAuth && window.AuraAuth.getUser) ? window.AuraAuth.getUser() : null;
        if (u && u.name) {{
            const unameEl = document.getElementById('uname');
            if (unameEl) unameEl.textContent = u.name.split(' ')[0] || u.name;
            document.querySelectorAll('.un').forEach(e => e.textContent = u.name.split(' ')[0]);
        }}
    }} else {{
        if (dash) dash.style.display = 'none';
        if (pub) {{
            pub.style.display = 'block';
        }}
        document.body.className = 'in-public';
        window.scrollTo(0, 0);

        if (target === 'about' || target === 'contact') {{
            setTimeout(() => {{
                if (window.switchTab) window.switchTab(target);
            }}, 50);
        }} else {{
            if (window.switchTab) window.switchTab('home');
        }}

        if (window.AuraAuth && window.AuraAuth.updatePublicHeader) {{
            window.AuraAuth.updatePublicHeader();
        }}
    }}
}};

// Logout Function
window.logout = function() {{
    if (window.AuraAuth && window.AuraAuth.clearUser) {{
        window.AuraAuth.clearUser();
    }}
    localStorage.removeItem('aura_user');
    window.navigateTo('home');
    if (window.AuraAuth && window.AuraAuth.updatePublicHeader) {{
        window.AuraAuth.updatePublicHeader();
    }}
}};
</script>

<script>
{auth_js}
</script>

<script>
{idx_scripts}
</script>

<script>
{dash_scripts}
</script>

<script>
document.addEventListener('DOMContentLoaded', function() {{
    // Initial public header update
    if (window.AuraAuth && window.AuraAuth.updatePublicHeader) {{
        window.AuraAuth.updatePublicHeader();
    }}

    // Check routing query parameter
    const params = new URLSearchParams(window.location.search);
    if (params.get('page') === 'dashboard') {{
        window.navigateTo('dashboard');
    }} else {{
        window.navigateTo('home');
    }}
}});
</script>
</body>
</html>
"""
    return unified


app_html = get_unified_html(groq_key)
components.html(app_html, height=1200, scrolling=True)
