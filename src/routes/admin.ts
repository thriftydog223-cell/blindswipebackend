import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, reportsTable, usersTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import path from "path";
import fs from "fs";

const router: IRouter = Router();

const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "admin-change-me";

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers["authorization"];
  if (auth?.startsWith("Bearer ") && auth.slice(7) === ADMIN_PASSWORD) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}

router.get("/admin/reports", requireAdmin, async (req, res) => {
  const reports = await db
    .select({
      id: reportsTable.id,
      reason: reportsTable.reason,
      notes: reportsTable.notes,
      status: reportsTable.status,
      createdAt: reportsTable.createdAt,
      reviewedAt: reportsTable.reviewedAt,
      reporter: {
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
      },
    })
    .from(reportsTable)
    .innerJoin(usersTable, eq(reportsTable.reporterId, usersTable.id))
    .orderBy(desc(reportsTable.createdAt));

  const reportedIds = [...new Set(reports.map((r) => r.reporter.id))];

  const reportedUsers = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      age: usersTable.age,
      city: usersTable.city,
      gender: usersTable.gender,
      intent: usersTable.intent,
      isBanned: usersTable.isBanned,
      photos: usersTable.photos,
    })
    .from(usersTable)
    .where(
      reports.length > 0
        ? eq(usersTable.id, reports[0]!.reporter.id)
        : eq(usersTable.id, "00000000-0000-0000-0000-000000000000"),
    );

  const reportedMap: Record<string, (typeof reportedUsers)[0]> = {};
  reportedUsers.forEach((u) => { reportedMap[u.id] = u; });

  const reportsWithReported = await Promise.all(
    reports.map(async (r) => {
      const [reported] = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          age: usersTable.age,
          city: usersTable.city,
          gender: usersTable.gender,
          intent: usersTable.intent,
          isBanned: usersTable.isBanned,
          photos: usersTable.photos,
        })
        .from(usersTable)
        .innerJoin(reportsTable, eq(reportsTable.reportedId, usersTable.id))
        .where(eq(reportsTable.id, r.id))
        .limit(1);
      return { ...r, reported: reported ?? null };
    }),
  );

  res.json(reportsWithReported);
});

router.post("/admin/reports/:id/ban", requireAdmin, async (req, res) => {
  const id = req.params.id as string;

  const [report] = await db
    .select({ reportedId: reportsTable.reportedId })
    .from(reportsTable)
    .where(eq(reportsTable.id, id))
    .limit(1);

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  await Promise.all([
    db
      .update(usersTable)
      .set({ isBanned: true })
      .where(eq(usersTable.id, report.reportedId)),
    db
      .update(reportsTable)
      .set({ status: "actioned", reviewedAt: new Date() })
      .where(eq(reportsTable.reportedId, report.reportedId)),
  ]);

  res.json({ message: "User banned and all reports actioned" });
});

router.post("/admin/reports/:id/dismiss", requireAdmin, async (req, res) => {
  const id = req.params.id as string;

  const [report] = await db
    .update(reportsTable)
    .set({ status: "reviewed", reviewedAt: new Date() })
    .where(eq(reportsTable.id, id))
    .returning();

  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  res.json({ message: "Report dismissed" });
});

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blind Swipe — Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0e17; color: #e8e8f0; min-height: 100vh; }
    .login-wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .login-card { background: #1a1926; border: 1px solid #2d2b55; border-radius: 16px; padding: 40px; width: 100%; max-width: 380px; }
    .logo { color: #ff3366; font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .logo-sub { color: #666; font-size: 13px; margin-bottom: 32px; }
    label { display: block; font-size: 13px; color: #aaa; margin-bottom: 6px; }
    input[type=password], input[type=text] { width: 100%; background: #0f0e17; border: 1px solid #2d2b55; border-radius: 10px; padding: 12px 14px; color: #fff; font-size: 15px; outline: none; transition: border-color .2s; }
    input:focus { border-color: #ff3366; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 12px 20px; border-radius: 10px; border: none; cursor: pointer; font-size: 14px; font-weight: 600; transition: opacity .15s; }
    .btn:hover { opacity: .85; }
    .btn-primary { background: #ff3366; color: #fff; width: 100%; margin-top: 16px; }
    .btn-ban { background: #ff3366; color: #fff; padding: 8px 14px; font-size: 13px; }
    .btn-dismiss { background: #2d2b55; color: #aaa; padding: 8px 14px; font-size: 13px; }
    .btn-unban { background: #2ecc71; color: #fff; padding: 8px 14px; font-size: 13px; }
    .err { color: #ff3366; font-size: 13px; margin-top: 10px; min-height: 18px; }
    /* Dashboard */
    header { background: #1a1926; border-bottom: 1px solid #2d2b55; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
    .header-logo { color: #ff3366; font-size: 18px; font-weight: 700; }
    .header-sub { color: #666; font-size: 12px; margin-top: 2px; }
    .logout-btn { background: transparent; border: 1px solid #2d2b55; color: #aaa; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; }
    .logout-btn:hover { border-color: #ff3366; color: #ff3366; }
    .main { padding: 24px; max-width: 1100px; margin: 0 auto; }
    .filter-bar { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
    .filter-btn { background: #1a1926; border: 1px solid #2d2b55; color: #aaa; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; transition: all .15s; }
    .filter-btn.active { background: #ff336620; border-color: #ff3366; color: #ff3366; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat { background: #1a1926; border: 1px solid #2d2b55; border-radius: 12px; padding: 18px; }
    .stat-num { font-size: 28px; font-weight: 700; color: #ff3366; }
    .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
    .reports-list { display: flex; flex-direction: column; gap: 12px; }
    .report-card { background: #1a1926; border: 1px solid #2d2b55; border-radius: 12px; padding: 20px; display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: start; }
    .report-card.actioned { opacity: .5; }
    .report-card.reviewed { opacity: .65; }
    .report-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .reason-badge { background: #ff336620; color: #ff3366; border: 1px solid #ff336640; border-radius: 6px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
    .status-badge { border-radius: 6px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
    .status-pending { background: #f5a62320; color: #f5a623; border: 1px solid #f5a62340; }
    .status-reviewed { background: #2ecc7120; color: #2ecc71; border: 1px solid #2ecc7140; }
    .status-actioned { background: #9b59b620; color: #9b59b6; border: 1px solid #9b59b640; }
    .user-info { display: flex; flex-direction: column; gap: 4px; }
    .user-name { font-size: 15px; font-weight: 600; color: #e8e8f0; }
    .user-meta { font-size: 12px; color: #666; }
    .banned-badge { background: #ff336630; color: #ff3366; border-radius: 4px; padding: 2px 7px; font-size: 11px; font-weight: 700; margin-left: 6px; vertical-align: middle; }
    .report-arrow { font-size: 12px; color: #666; margin: 0 8px; }
    .actions { display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }
    .date { font-size: 11px; color: #555; margin-top: 8px; }
    .notes { font-size: 13px; color: #888; margin-top: 6px; font-style: italic; }
    .empty { text-align: center; padding: 48px; color: #555; }
    .section-title { font-size: 14px; font-weight: 600; color: #aaa; margin-bottom: 16px; text-transform: uppercase; letter-spacing: .05em; }
    .toast { position: fixed; bottom: 24px; right: 24px; background: #1a1926; border: 1px solid #2d2b55; border-radius: 10px; padding: 14px 20px; font-size: 14px; color: #e8e8f0; box-shadow: 0 8px 32px #00000080; z-index: 100; transform: translateY(100px); transition: transform .3s; }
    .toast.show { transform: translateY(0); }
    .toast.success { border-color: #2ecc71; color: #2ecc71; }
    .toast.error { border-color: #ff3366; color: #ff3366; }
  </style>
</head>
<body>
  <div id="app"></div>
  <div class="toast" id="toast"></div>

  <script>
    const API = '';
    let adminPassword = localStorage.getItem('adminPwd') || '';
    let allReports = [];
    let currentFilter = 'pending';

    function showToast(msg, type = 'success') {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'toast show ' + type;
      setTimeout(() => { t.className = 'toast'; }, 3000);
    }

    function formatDate(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleString();
    }

    function renderLogin() {
      document.getElementById('app').innerHTML = \`
        <div class="login-wrap">
          <div class="login-card">
            <div class="logo">Blind Swipe</div>
            <div class="logo-sub">Admin Dashboard</div>
            <label>Admin Password</label>
            <input type="password" id="pwd" placeholder="Enter admin password" onkeydown="if(event.key==='Enter')login()" autofocus />
            <button class="btn btn-primary" onclick="login()">Sign in</button>
            <div class="err" id="login-err"></div>
          </div>
        </div>
      \`;
    }

    async function login() {
      const pwd = document.getElementById('pwd').value;
      const r = await fetch(API + '/api/admin/reports', { headers: { Authorization: 'Bearer ' + pwd } });
      if (r.ok) {
        adminPassword = pwd;
        localStorage.setItem('adminPwd', pwd);
        await loadDashboard();
      } else {
        document.getElementById('login-err').textContent = 'Incorrect password';
      }
    }

    function logout() {
      adminPassword = '';
      localStorage.removeItem('adminPwd');
      renderLogin();
    }

    async function apiCall(path, method = 'GET', body) {
      const r = await fetch(API + path, {
        method,
        headers: { Authorization: 'Bearer ' + adminPassword, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 401) { logout(); return null; }
      return r.json();
    }

    async function loadDashboard() {
      const data = await apiCall('/api/admin/reports');
      if (!data) return;
      allReports = data;
      renderDashboard();
    }

    function renderDashboard() {
      const filtered = currentFilter === 'all' ? allReports : allReports.filter(r => r.status === currentFilter);
      const pending = allReports.filter(r => r.status === 'pending').length;
      const reviewed = allReports.filter(r => r.status === 'reviewed').length;
      const actioned = allReports.filter(r => r.status === 'actioned').length;

      document.getElementById('app').innerHTML = \`
        <header>
          <div>
            <div class="header-logo">Blind Swipe Admin</div>
            <div class="header-sub">Report Management Dashboard</div>
          </div>
          <button class="logout-btn" onclick="logout()">Sign out</button>
        </header>
        <div class="main">
          <div class="stats">
            <div class="stat"><div class="stat-num">\${pending}</div><div class="stat-label">Pending</div></div>
            <div class="stat"><div class="stat-num">\${reviewed}</div><div class="stat-label">Dismissed</div></div>
            <div class="stat"><div class="stat-num">\${actioned}</div><div class="stat-label">Actioned</div></div>
            <div class="stat"><div class="stat-num">\${allReports.length}</div><div class="stat-label">Total Reports</div></div>
          </div>

          <div class="filter-bar">
            <button class="filter-btn \${currentFilter==='pending'?'active':''}" onclick="setFilter('pending')">Pending (\${pending})</button>
            <button class="filter-btn \${currentFilter==='reviewed'?'active':''}" onclick="setFilter('reviewed')">Dismissed</button>
            <button class="filter-btn \${currentFilter==='actioned'?'active':''}" onclick="setFilter('actioned')">Actioned</button>
            <button class="filter-btn \${currentFilter==='all'?'active':''}" onclick="setFilter('all')">All</button>
          </div>

          <div class="section-title">\${currentFilter === 'all' ? 'All Reports' : currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1) + ' Reports'} (\${filtered.length})</div>
          <div class="reports-list" id="reports-list">
            \${filtered.length === 0 ? '<div class="empty">No reports found</div>' : filtered.map(renderReport).join('')}
          </div>
        </div>
      \`;
    }

    function renderReport(r) {
      const reported = r.reported;
      const reporter = r.reporter;
      const isBanned = reported?.isBanned;
      const statusClass = 'status-' + r.status;

      return \`
        <div class="report-card \${r.status}" id="report-\${r.id}">
          <div>
            <div class="report-top">
              <span class="reason-badge">\${r.reason}</span>
              <span class="status-badge \${statusClass}">\${r.status}</span>
            </div>
            <div style="display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap;">
              <div class="user-info">
                <div style="font-size:11px;color:#555;margin-bottom:4px;">REPORTED USER</div>
                <div class="user-name">
                  \${reported?.name || '—'}
                  \${isBanned ? '<span class="banned-badge">BANNED</span>' : ''}
                </div>
                <div class="user-meta">\${reported?.email || '—'}</div>
                <div class="user-meta">\${reported?.age ? reported.age + ' · ' : ''}\${reported?.city || ''}\${reported?.gender ? ' · ' + reported.gender : ''}</div>
                <div class="user-meta">Intent: \${reported?.intent || '—'}</div>
              </div>
              <div style="align-self:center;color:#555;font-size:20px;">←</div>
              <div class="user-info">
                <div style="font-size:11px;color:#555;margin-bottom:4px;">REPORTED BY</div>
                <div class="user-name">\${reporter?.name || '—'}</div>
                <div class="user-meta">\${reporter?.email || '—'}</div>
              </div>
            </div>
            \${r.notes ? \`<div class="notes">"\${r.notes}"</div>\` : ''}
            <div class="date">Reported \${formatDate(r.createdAt)}\${r.reviewedAt ? ' · Reviewed ' + formatDate(r.reviewedAt) : ''}</div>
          </div>
          <div class="actions">
            \${!isBanned && r.status !== 'actioned' ? \`<button class="btn btn-ban" onclick="banUser('\${r.id}')">Ban User</button>\` : ''}
            \${isBanned && r.status !== 'actioned' ? \`<button class="btn btn-ban" style="opacity:.5" disabled>Banned</button>\` : ''}
            \${r.status === 'pending' ? \`<button class="btn btn-dismiss" onclick="dismissReport('\${r.id}')">Dismiss</button>\` : ''}
          </div>
        </div>
      \`;
    }

    function setFilter(f) {
      currentFilter = f;
      renderDashboard();
    }

    async function banUser(reportId) {
      if (!confirm('Ban this user? They will be immediately locked out of the app.')) return;
      const data = await apiCall('/api/admin/reports/' + reportId + '/ban', 'POST');
      if (data) {
        showToast('User banned and all reports actioned');
        await loadDashboard();
      }
    }

    async function dismissReport(reportId) {
      const data = await apiCall('/api/admin/reports/' + reportId + '/dismiss', 'POST');
      if (data) {
        showToast('Report dismissed', 'success');
        await loadDashboard();
      }
    }

    async function init() {
      if (adminPassword) {
        const r = await fetch(API + '/api/admin/reports', { headers: { Authorization: 'Bearer ' + adminPassword } });
        if (r.ok) {
          allReports = await r.json();
          renderDashboard();
          return;
        }
      }
      renderLogin();
    }

    init();
  </script>
</body>
</html>`;

router.get("/admin/verifications", requireAdmin, async (req, res) => {
  const pending = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      age: usersTable.age,
      idVerificationStatus: usersTable.idVerificationStatus,
      idPhotoUrl: usersTable.idPhotoUrl,
      dateOfBirth: usersTable.dateOfBirth,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.idVerificationStatus, "pending"))
    .orderBy(desc(usersTable.createdAt));

  res.json({ verifications: pending });
});

router.post("/admin/verifications/:userId/approve", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  await db
    .update(usersTable)
    .set({ idVerificationStatus: "verified", updatedAt: new Date() })
    .where(eq(usersTable.id, String(userId)));
  res.json({ message: "User verified" });
});

router.post("/admin/verifications/:userId/reject", requireAdmin, async (req, res) => {
  const { userId } = req.params;
  await db
    .update(usersTable)
    .set({ idVerificationStatus: "rejected", updatedAt: new Date() })
    .where(eq(usersTable.id, String(userId)));
  res.json({ message: "Verification rejected" });
});

router.get("/admin", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(ADMIN_HTML);
});

export default router;
