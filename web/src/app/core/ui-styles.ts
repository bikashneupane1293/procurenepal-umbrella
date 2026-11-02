// Shared navy + gold styles used by all inside pages
export const UI_STYLES = `
  :host { display: block; }
  h1 { margin: 0 0 4px; font-size: 26px; color: #0a1f3d; }
  .sub { margin: 0 0 20px; color: #4b5563; }
  .bar { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
  .btn { background: #0a1f3d; color: #fff; border: 0; padding: 10px 18px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px; }
  .btn:hover { background: #1e3a5f; }
  .btn:disabled { opacity: 0.6; cursor: wait; }
  .btn.gold { background: #d4a017; color: #0a1f3d; }
  .btn.gold:hover { background: #f5b942; }
  .btn.light { background: #e8eef6; color: #0a1f3d; }
  .btn.danger { background: #fff; color: #dc2626; border: 1px solid #fecaca; padding: 6px 12px; }
  .panel { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  .panel h2 { margin: 0 0 16px; font-size: 18px; color: #0a1f3d; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
  label { display: block; font-size: 13px; font-weight: 600; color: #1e3a5f; margin-bottom: 6px; }
  label .req { color: #dc2626; }
  input, select { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; background: #fff; color: #1f2937; }
  input:focus, select:focus { outline: 2px solid #d4a017; border-color: #d4a017; }
  .help { font-size: 11px; color: #9ca3af; margin-top: 4px; }
  .actions { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
  .msg { padding: 12px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  .msg.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
  .msg.ok { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
  .msg.info { background: #fef5e0; color: #8a6508; border: 1px solid #f5d98a; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 10px 12px; background: #e8eef6; color: #0a1f3d; font-weight: 700; white-space: nowrap; }
  td { padding: 10px 12px; border-bottom: 1px solid #eef0f2; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .empty { text-align: center; color: #9ca3af; padding: 28px; }
  .tag { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: #e8eef6; color: #1e3a5f; white-space: nowrap; }
  .tag.gold { background: #fef5e0; color: #8a6508; }
  .tag.green { background: #dcfce7; color: #15803d; }
  a.link { color: #b8860b; font-weight: 600; text-decoration: none; cursor: pointer; }
  a.link:hover { text-decoration: underline; }
`;
