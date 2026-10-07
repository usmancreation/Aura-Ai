/**
 * aura_auth.js - Centralized Authentication & Authorization for AuraAI
 * Powered by Firebase Authentication & Google Cloud Firestore Database.
 * Connects all forms with Firebase Auth & Firestore, manages session tokens, dynamic header, and route protection.
 */
(function(window) {
  const STORAGE_KEY = 'aura_user';

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDOv6h1H6gbYn8RyYImq-m5OTjvLu9Edc4",
    authDomain: "aura-c07ad.firebaseapp.com",
    projectId: "aura-c07ad",
    storageBucket: "aura-c07ad.firebasestorage.app",
    messagingSenderId: "422030901114",
    appId: "1:422030901114:web:c6b0eb3bf6b22d93b160c3"
  };

  const AUTH_BASE = "https://identitytoolkit.googleapis.com/v1/accounts";
  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

  // Firestore helper: convert Firestore JSON fields to plain JS object
  function parseFirestoreFields(fields) {
    if (!fields) return {};
    const res = {};
    for (const key in fields) {
      const val = fields[key];
      if (val.stringValue !== undefined) res[key] = val.stringValue;
      else if (val.integerValue !== undefined) res[key] = parseInt(val.integerValue, 10);
      else if (val.booleanValue !== undefined) res[key] = val.booleanValue;
      else if (val.doubleValue !== undefined) res[key] = parseFloat(val.doubleValue);
      else if (val.timestampValue !== undefined) res[key] = val.timestampValue;
      else res[key] = val;
    }
    return res;
  }

  // Firestore helper: convert plain JS object to Firestore typed fields
  function toFirestoreFields(obj) {
    const fields = {};
    for (const key in obj) {
      const val = obj[key];
      if (typeof val === 'string') {
        fields[key] = { stringValue: val };
      } else if (typeof val === 'number') {
        if (Number.isInteger(val)) fields[key] = { integerValue: String(val) };
        else fields[key] = { doubleValue: val };
      } else if (typeof val === 'boolean') {
        fields[key] = { booleanValue: val };
      }
    }
    return { fields };
  }

  const AuraAuth = {
    getUser: function() {
      try {
        const item = localStorage.getItem(STORAGE_KEY);
        return item ? JSON.parse(item) : null;
      } catch (e) {
        return null;
      }
    },

    setUser: function(user) {
      if (user) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    },

    clearUser: function() {
      localStorage.removeItem(STORAGE_KEY);
    },

    isAuthenticated: function() {
      const u = this.getUser();
      return !!(u && u.name && u.uid && (u.idToken || u.provider === 'firebase'));
    },

    checkAuth: async function() {
      const user = this.getUser();
      if (!user) return null;

      // Auto-refresh Firebase ID token if close to expiry
      if (user.refreshToken && user.expiresAt && Date.now() > (user.expiresAt - 300000)) {
        try {
          const rfRes = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(user.refreshToken)}`
          });
          if (rfRes.ok) {
            const rfData = await rfRes.json();
            user.idToken = rfData.id_token;
            user.refreshToken = rfData.refresh_token;
            user.expiresAt = Date.now() + (parseInt(rfData.expires_in || 3600, 10) * 1000);
            this.setUser(user);
          }
        } catch (e) {
          console.warn('Token auto-refresh notice:', e);
        }
      }
      return user;
    },

    login: async function(email, password) {
      email = (email || '').trim();
      password = password || '';
      if (!email || !password) {
        return { success: false, error: 'Email and password are required.' };
      }

      try {
        // 1. Firebase Authentication: signInWithPassword
        const authRes = await fetch(`${AUTH_BASE}:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
        });
        const authData = await authRes.json();

        if (!authRes.ok) {
          const errCode = authData.error?.message || 'LOGIN_FAILED';
          const friendly = {
            'EMAIL_NOT_FOUND': 'No account found with this email.',
            'INVALID_PASSWORD': 'Incorrect password. Please try again.',
            'USER_DISABLED': 'This user account has been disabled.',
            'TOO_MANY_ATTEMPTS_TRY_LATER': 'Access temporarily blocked due to many failed attempts. Try again later.'
          }[errCode] || authData.error?.message || 'Authentication failed.';
          return { success: false, error: friendly };
        }

        const uid = authData.localId;
        const idToken = authData.idToken;
        const refreshToken = authData.refreshToken;

        // 2. Fetch User Profile from Google Cloud Firestore Database
        let profile = {
          name: email.split('@')[0],
          role: 'Tech Professional',
          career_goal: 'Full-Stack & AI Engineer',
          progress: 20
        };

        try {
          const fsRes = await fetch(`${FIRESTORE_BASE}/users/${uid}`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
          });
          if (fsRes.ok) {
            const fsData = await fsRes.json();
            const loaded = parseFirestoreFields(fsData.fields);
            if (loaded && loaded.name) {
              profile = Object.assign(profile, loaded);
            }
          } else {
            // First time Firestore write for this existing account
            await fetch(`${FIRESTORE_BASE}/users/${uid}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
              },
              body: JSON.stringify(toFirestoreFields({
                uid: uid,
                name: profile.name,
                email: email,
                role: profile.role,
                career_goal: profile.career_goal,
                progress: profile.progress,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }))
            }).catch(() => null);
          }
        } catch (fsErr) {
          console.warn('Firestore fetch notice:', fsErr);
        }

        const userObj = {
          id: uid,
          uid: uid,
          name: profile.name,
          email: email,
          role: profile.role || 'Tech Professional',
          career_goal: profile.career_goal || '',
          progress: profile.progress || 20,
          idToken: idToken,
          refreshToken: refreshToken,
          expiresAt: Date.now() + (parseInt(authData.expiresIn || 3600, 10) * 1000),
          initials: this.getInitials(profile.name),
          provider: 'firebase'
        };

        this.setUser(userObj);
        this.updatePublicHeader();

        // Also sync with backend session if available
        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password })
        }).catch(() => null);

        return { success: true, user: userObj };
      } catch (netErr) {
        return { success: false, error: 'Network error connecting to Firebase: ' + (netErr.message || String(netErr)) };
      }
    },

    register: async function(name, email, password) {
      name = (name || '').trim();
      email = (email || '').trim();
      password = password || '';

      if (!name || name.length < 2) {
        return { success: false, error: 'Please enter your full name.' };
      }
      if (!email) {
        return { success: false, error: 'Please enter a valid email address.' };
      }
      if (!password || password.length < 6) {
        return { success: false, error: 'Password must be at least 6 characters.' };
      }

      try {
        // 1. Firebase Authentication: signUp
        const authRes = await fetch(`${AUTH_BASE}:signUp?key=${FIREBASE_CONFIG.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
        });
        const authData = await authRes.json();

        if (!authRes.ok) {
          const errCode = authData.error?.message || 'SIGNUP_FAILED';
          const friendly = {
            'EMAIL_EXISTS': 'An account with this email address already exists.',
            'OPERATION_NOT_ALLOWED': 'Password sign-in is not enabled in Firebase.',
            'TOO_MANY_ATTEMPTS_TRY_LATER': 'Too many attempts. Please try again later.',
            'WEAK_PASSWORD : Password should be at least 6 characters': 'Password should be at least 6 characters.'
          }[errCode] || authData.error?.message || 'Registration failed.';
          return { success: false, error: friendly };
        }

        const uid = authData.localId;
        const idToken = authData.idToken;
        const refreshToken = authData.refreshToken;

        // 2. Write User Document into Google Cloud Firestore Database
        const docPayload = toFirestoreFields({
          uid: uid,
          name: name,
          email: email,
          role: 'Tech Professional',
          career_goal: 'AI & Career Acceleration',
          progress: 20,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

        try {
          await fetch(`${FIRESTORE_BASE}/users/${uid}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(docPayload)
          });
        } catch (fsErr) {
          console.warn('Firestore write notice:', fsErr);
        }

        const userObj = {
          id: uid,
          uid: uid,
          name: name,
          email: email,
          role: 'Tech Professional',
          career_goal: 'AI & Career Acceleration',
          progress: 20,
          idToken: idToken,
          refreshToken: refreshToken,
          expiresAt: Date.now() + (parseInt(authData.expiresIn || 3600, 10) * 1000),
          initials: this.getInitials(name),
          provider: 'firebase'
        };

        this.setUser(userObj);
        this.updatePublicHeader();

        // Also sync with backend session if available
        fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, email: email, password: password })
        }).catch(() => null);

        return { success: true, user: userObj };
      } catch (netErr) {
        return { success: false, error: 'Network error connecting to Firebase: ' + (netErr.message || String(netErr)) };
      }
    },

    logout: async function() {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) {}
      this.clearUser();
      localStorage.removeItem('aura_user');

      // If running inside SPA mode (Streamlit unified container)
      if (typeof window.navigateTo === 'function') {
        window.navigateTo('home');
        this.updatePublicHeader();
        return;
      }

      // Normal multi-page fallback
      try {
        if (window.top && window.top !== window) {
          window.top.location.href = 'index.html';
          return;
        }
      } catch (e) {}
      window.location.href = 'index.html';
    },

    getInitials: function(name) {
      if (!name) return 'U';
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    },

    /**
     * Updates public site headers (index.html, signin.html, signup.html, etc.)
     * Switches between [Login / Register] and [User Avatar + Dashboard Dropdown with Logout]
     */
    updatePublicHeader: function() {
      const user = this.getUser();
      const actionsContainers = document.querySelectorAll('.nav-actions, #headerAuthArea, .mobile-drawer-actions');
      
      actionsContainers.forEach(container => {
        if (!container) return;

        if (user && user.name) {
          const initials = this.getInitials(user.name);
          const firstName = user.name.split(' ')[0];

          // Check if this is the mobile drawer container
          if (container.classList.contains('mobile-drawer-actions')) {
            container.innerHTML = `
              <div style="padding: 10px 0; border-top: 1px solid rgba(85,155,255,0.2); margin-top: 8px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                  <div style="width:34px; height:34px; border-radius:50%; background:linear-gradient(135deg, #258cff, #22e0c0); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px;">${initials}</div>
                  <div>
                    <div style="font-weight:700; color:#fff; font-size:0.95rem;">${escapeHtml(user.name)}</div>
                    <div style="font-size:0.75rem; color:#9eb5dc;">${escapeHtml(user.email)}</div>
                  </div>
                </div>
                <a class="btn btn-primary" href="javascript:void(0)" onclick="if(typeof window.navigateTo==='function'){window.navigateTo('dashboard');}else{window.location.href='dashboard.html';}" style="width:100%; justify-content:center; margin-bottom:8px; display:inline-flex; align-items:center; gap:8px;">
                  <span>Dashboard</span> →
                </a>
                <button type="button" class="btn" onclick="if(typeof window.logout==='function'){window.logout();}else{AuraAuth.logout();}" style="width:100%; justify-content:center; background:rgba(239,68,68,0.15); border-color:rgba(239,68,68,0.4); color:#fca5a5;">
                  Sign Out
                </button>
              </div>
            `;
          } else {
            // Desktop Header Container
            container.innerHTML = `
              <div style="display:inline-flex; align-items:center; gap:10px;">
                <a class="btn primary" href="javascript:void(0)" onclick="if(typeof window.navigateTo==='function'){window.navigateTo('dashboard');}else{window.location.href='dashboard.html';}" style="padding:8px 18px; border-radius:12px; font-size:0.9rem; font-weight:700; display:inline-flex; align-items:center; gap:6px;">
                  <span>Dashboard</span> &rarr;
                </a>
                <div class="aura-user-menu" style="position:relative; display:inline-block;">
                  <button type="button" class="btn btn-user-toggle" id="auraUserBtn" style="display:inline-flex; align-items:center; gap:9px; padding:7px 14px; background:rgba(14,46,109,0.7); border:1px solid rgba(85,155,255,0.4); border-radius:99px; cursor:pointer;">
                    <span style="width:26px; height:26px; border-radius:50%; background:linear-gradient(135deg, #258cff, #22e0c0); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:11px; box-shadow:0 0 10px rgba(37,140,255,0.4);">${initials}</span>
                    <span style="font-weight:600; color:#f4f8ff; font-size:0.9rem;">${escapeHtml(firstName)}</span>
                    <span style="font-size:10px; color:#9eb5dc; transition:transform 0.2s;" id="auraUserArrow">▼</span>
                  </button>
                  <div class="aura-dropdown" id="auraUserDropdown" style="display:none; position:absolute; right:0; top:calc(100% + 8px); width:230px; background:#07173b; border:1px solid rgba(85,155,255,0.3); border-radius:12px; box-shadow:0 12px 35px rgba(0,0,0,0.65), 0 0 20px rgba(37,140,255,0.2); padding:10px; z-index:99999;">
                    <div style="padding:8px 10px 10px; border-bottom:1px solid rgba(85,155,255,0.18);">
                      <div style="font-weight:700; color:#fff; font-size:0.92rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(user.name)}</div>
                      <div style="font-size:0.75rem; color:#9eb5dc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(user.email)}</div>
                    </div>
                    <div style="padding:6px 0;">
                      <a href="javascript:void(0)" onclick="if(typeof window.navigateTo==='function'){window.navigateTo('dashboard');}else{window.location.href='dashboard.html';}" style="display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; color:#d2e2fe; font-size:0.88rem; font-weight:600; text-decoration:none; transition:background 0.2s;" onmouseover="this.style.background='rgba(37,140,255,0.15)'" onmouseout="this.style.background='transparent'">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3aa0ff" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                        Dashboard
                      </a>
                    </div>
                    <div style="border-top:1px solid rgba(85,155,255,0.18); padding-top:6px;">
                      <button type="button" onclick="if(typeof window.logout==='function'){window.logout();}else{AuraAuth.logout();}" style="width:100%; display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; color:#fca5a5; font-size:0.88rem; font-weight:600; background:transparent; border:none; cursor:pointer; transition:background 0.2s; text-align:left;" onmouseover="this.style.background='rgba(239,68,68,0.15)'" onmouseout="this.style.background='transparent'">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                        Sign Out (Logout)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            `;

            // Setup dropdown toggle
            const toggleBtn = container.querySelector('#auraUserBtn');
            const dropdown = container.querySelector('#auraUserDropdown');
            const arrow = container.querySelector('#auraUserArrow');
            if (toggleBtn && dropdown) {
              toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = dropdown.style.display === 'block';
                dropdown.style.display = isOpen ? 'none' : 'block';
                if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
              });
              document.addEventListener('click', () => {
                dropdown.style.display = 'none';
                if (arrow) arrow.style.transform = 'rotate(0deg)';
              });
            }
          }
        }
      });
    },

    /**
     * Initializes user session on dashboard.html
     * Redirects to signin if not authenticated.
     */
    initDashboard: function() {
      if (!this.isAuthenticated()) {
        if (typeof window.navigateTo === 'function') {
          window.navigateTo('home');
          setTimeout(() => {
            if (typeof openModal === 'function') openModal('login');
          }, 300);
          return;
        }
        window.location.href = 'signin.html';
        return;
      }

      const user = this.getUser();

      // Populate user info dynamically
      const unameEl = document.getElementById('uname');
      if (unameEl) unameEl.textContent = user.name;

      const firstName = user.name.split(' ')[0];
      document.querySelectorAll('.un').forEach(el => {
        el.textContent = firstName;
      });

      const initials = this.getInitials(user.name);

      // Enhance user widget in dashboard top bar
      const userBox = document.querySelector('.user');
      if (userBox) {
        userBox.style.cursor = 'pointer';
        userBox.style.position = 'relative';
        
        // Replace avatar icon with user initials badge
        const av = userBox.querySelector('.av');
        if (av) {
          av.innerHTML = `<span style="font-size:12px; font-weight:800; color:#fff; display:flex; align-items:center; justify-content:center; width:100%; height:100%;">${initials}</span>`;
          av.style.background = 'linear-gradient(135deg, #1f6fe0, #22e0c0)';
        }

        // Add dropdown to dashboard user widget
        const existingDropdown = document.getElementById('dashUserDropdown');
        if (!existingDropdown) {
          const dropdown = document.createElement('div');
          dropdown.id = 'dashUserDropdown';
          dropdown.style.cssText = 'display:none; position:absolute; right:0; top:calc(100% + 10px); width:240px; background:#07173b; border:1px solid rgba(85,155,255,0.3); border-radius:12px; box-shadow:0 12px 35px rgba(0,0,0,0.7), 0 0 20px rgba(37,140,255,0.2); padding:10px; z-index:99999; text-align:left;';
          dropdown.innerHTML = `
            <div style="padding:8px 10px 10px; border-bottom:1px solid rgba(85,155,255,0.18);">
              <div style="font-weight:700; color:#fff; font-size:0.95rem;">${escapeHtml(user.name)}</div>
              <div style="font-size:0.75rem; color:#9eb5dc;">${escapeHtml(user.email)}</div>
            </div>
            <div style="padding:6px 0;">
              <a href="index.html" style="display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; color:#d2e2fe; font-size:0.88rem; font-weight:600; text-decoration:none; transition:background 0.2s;" onmouseover="this.style.background='rgba(37,140,255,0.15)'" onmouseout="this.style.background='transparent'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3aa0ff" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                Return to Home
              </a>
            </div>
            <div style="border-top:1px solid rgba(85,155,255,0.18); padding-top:6px;">
              <button type="button" onclick="AuraAuth.logout()" style="width:100%; display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; color:#fca5a5; font-size:0.88rem; font-weight:600; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); cursor:pointer; transition:background 0.2s; text-align:left;" onmouseover="this.style.background='rgba(239,68,68,0.22)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                Sign Out (Logout)
              </button>
            </div>
          `;
          userBox.appendChild(dropdown);

          userBox.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display === 'block';
            dropdown.style.display = isOpen ? 'none' : 'block';
          });
          document.addEventListener('click', () => {
            dropdown.style.display = 'none';
          });
        }
      }

      // Add logout option to dashboard mobile drawer
      const mobileMenu = document.querySelector('.mobile-menu');
      if (mobileMenu && !document.getElementById('mobileLogoutBtn')) {
        const mLogout = document.createElement('button');
        mLogout.id = 'mobileLogoutBtn';
        mLogout.style.cssText = 'color:#fca5a5; border-color:rgba(239,68,68,0.3); background:rgba(239,68,68,0.1); margin-top:12px;';
        mLogout.innerHTML = `<span>⏻</span>Sign Out (${escapeHtml(firstName)})`;
        mLogout.onclick = () => AuraAuth.logout();
        mobileMenu.appendChild(mLogout);
      }
    }
  };

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Export to window
  window.AuraAuth = AuraAuth;

  // Run automatically on DOM content loaded
  document.addEventListener('DOMContentLoaded', () => {
    // If we're on dashboard.html
    if (window.location.pathname.includes('dashboard') || document.querySelector('.app aside.left')) {
      AuraAuth.initDashboard();
    } else {
      // Public pages (index, about, contact, signin, signup)
      AuraAuth.updatePublicHeader();
    }
  });

})(window);
