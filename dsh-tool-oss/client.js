/**
 * OSS file browser — browser half.
 *
 * OssTrigger → OssPanel (centered) → UploadDialog (centered)
 * Supports: browse, multi-bucket, upload (text/file/folder), view, delete file/folder.
 */
window.__ModuleLoader__.load({
  id: "dsh-tool-oss",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    var inject = ["slots", "connection"];

    function fmtSize(n) {
      if (n == null || isNaN(n)) return "?";
      if (n < 1024) return n + " B";
      if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
      if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
      return (n / 1073741824).toFixed(2) + " GB";
    }
    function relTime(iso) {
      if (!iso) return "";
      var t = Date.parse(iso); if (isNaN(t)) return iso;
      var d = Date.now() - t;
      if (d < 60000) return "刚刚";
      var m = Math.floor(d / 60000); if (m < 60) return m + " 分钟前";
      var h = Math.floor(m / 60); if (h < 24) return h + " 小时前";
      return Math.floor(h / 24) + " 天前";
    }
    function fIcon(k) {
      var e = (k || "").split(".").pop().toLowerCase();
      if (["png","jpg","jpeg","gif","webp","svg"].indexOf(e) >= 0) return "🖼";
      if (["json","yaml","yml"].indexOf(e) >= 0) return "⚙";
      if (["md","txt","log"].indexOf(e) >= 0) return "📄";
      if (["js","ts","py","go","rs","java"].indexOf(e) >= 0) return "📜";
      if (["zip","gz","tar","7z"].indexOf(e) >= 0) return "🗜";
      return "📦";
    }

    var Z = {
      overlay: function(z) { return { position:"fixed", inset:"0", zIndex:z||1500, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,.5)" }; },
      card: function(w, h) { return { background:"var(--dsw-alias-bg-overlay, #fff)", border:"1px solid var(--dsw-alias-border-l1, #e0e0e0)", borderRadius:"16px", boxShadow:"0 20px 60px rgba(0,0,0,.3)", width:"min("+(w||520)+"px, calc(100vw - 32px))", maxHeight:"min("+(h||82)+"vh, 760px)", display:"flex", flexDirection:"column", overflow:"hidden" }; },
      header: { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 20px", borderBottom:"1px solid var(--dsw-alias-border-l1, #e0e0e0)" },
      headerTitle: { color:"var(--dsw-alias-label-primary, #1a1a1a)", fontWeight:"600", fontSize:"15px" },
      closeBtn: { border:"0", background:"transparent", color:"var(--dsw-alias-label-secondary, #999)", fontSize:"22px", lineHeight:"1", cursor:"pointer", padding:"0 4px" },
      body: { flex:"1 1 auto", overflow:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:"12px" },
      btnPrimary: function(disabled) { return { padding:"8px 22px", border:"1px solid transparent", borderRadius:"10px", background: disabled ? "var(--dsw-alias-bg-layer-2, #f0f0f0)" : "var(--dsw-alias-color-accent, #4a8cff)", color: disabled ? "var(--dsw-alias-label-secondary, #999)" : "#fff", fontFamily:"inherit", fontSize:"13px", cursor: disabled ? "not-allowed" : "pointer", fontWeight:"500", whiteSpace:"nowrap" }; },
      btnSecondary: { padding:"8px 22px", border:"1px solid var(--dsw-alias-border-l1, #e0e0e0)", borderRadius:"10px", background:"var(--dsw-alias-bg-layer-2, #f0f0f0)", color:"var(--dsw-alias-label-primary, #1a1a1a)", fontFamily:"inherit", fontSize:"13px", cursor:"pointer", whiteSpace:"nowrap" },
    };

    function ModalDialog(props) {
      var isAlert = !props.onCancel;
      return React.createElement("div", { onClick: isAlert ? undefined : props.onCancel, style: Z.overlay(1600) },
        React.createElement("div", { onClick: function(e){e.stopPropagation();}, style: Z.card(440, 80) },
          React.createElement("div", { style: Z.header }, React.createElement("span", { style: Z.headerTitle }, props.title || (isAlert ? "提示" : "确认"))),
          React.createElement("div", { style: { padding:"8px 22px 20px", fontSize:"13px", color:"var(--dsw-alias-label-secondary, #666)", lineHeight:"1.7", wordBreak:"break-word", whiteSpace:"pre-wrap" } }, props.message),
          React.createElement("div", { style: { display:"flex", gap:"10px", justifyContent:"flex-end", padding:"0 20px 18px" } },
            isAlert ? null : React.createElement("button", { type:"button", onClick: props.onCancel, style: Z.btnSecondary }, props.cancelLabel || "取消"),
            React.createElement("button", { type:"button", onClick: props.onConfirm, style: Z.btnPrimary(false) }, props.confirmLabel || (isAlert ? "知道了" : "确定"))
          )
        )
      );
    }

    function UploadDialog(props) {
      var conn = props.connection;
      var prov = props.provider;
      var pfx = props.prefix;

      var tabS = React.useState("file"); var tab = tabS[0]; var setTab = tabS[1];
      var tKeyS = React.useState(""); var tKey = tKeyS[0]; var setTKey = tKeyS[1];
      var tTxtS = React.useState(""); var tTxt = tTxtS[0]; var setTTxt = tTxtS[1];
      var busyS = React.useState(false); var busy = busyS[0]; var setBusy = busyS[1];
      var progS = React.useState(null); var prog = progS[0]; var setProg = progS[1];

      function toB64(file, cb) {
        var r = new FileReader();
        r.onload = function() {
          var a = new Uint8Array(r.result); var s = ""; var c = 8192;
          for (var i = 0; i < a.length; i += c) s += String.fromCharCode.apply(null, a.subarray(i, Math.min(i + c, a.length)));
          cb(btoa(s));
        };
        r.onerror = function() { cb(null); };
        r.readAsArrayBuffer(file);
      }

      function onPick(fileList) {
        if (!fileList || !fileList.length) return;
        var files = Array.prototype.slice.call(fileList);
        // Filter out macOS/Windows junk files (.DS_Store, Thumbs.db, etc.)
        files = files.filter(function(f) {
          var name = f.name;
          if (name.startsWith('.')) return false;
          if (name === 'Thumbs.db' || name === 'Desktop.ini') return false;
          return true;
        });
        if (!files.length) return;
        var pairs = files.map(function(f) {
          var key = (f.webkitRelativePath && f.webkitRelativePath.indexOf("/") >= 0) ? f.webkitRelativePath : f.name;
          return { file: f, key: key };
        });
        startUpload(pairs);
      }

      function startUpload(pairs) {
        if (pairs.length > 1) {
          var items = []; var totalBytes = 0; var idx = 0;
          var pfxParts = (pfx || "").split("/").filter(Boolean);
          setBusy(true); setProg({ done: 0, total: pairs.length, bytes: 0, uploading: false });
          function next() {
            if (idx >= pairs.length) {
              setProg({ done: pairs.length, total: pairs.length, bytes: totalBytes, uploading: true });
              conn.rpc.call("/oss", "putBatch", { provider: prov, prefix: pfxParts.join("/"), files: items }).then(function(res) {
                setBusy(false);
                if (res && res.ok && res.value) {
                  var v = res.value;
                  if (v.failed > 0) { setProg({ error: v.ok + " 成功, " + v.failed + " 失败\n" + (v.errors || []).map(function(e) { return e.key + ": " + e.message; }).join("\n") }); }
                  else { setProg(null); props.onDone(); }
                } else { setProg({ error: (res && res.error && res.error.message) || "unknown" }); }
              }).catch(function(e) { setBusy(false); setProg({ error: String((e && e.message) || e) }); });
              return;
            }
            var pair = pairs[idx]; idx++;
            var file = pair.file; var key = pair.key;
            if (!key) { next(); return; }
            toB64(file, function(b64) {
              if (!b64) { setProg({ done: idx, total: pairs.length, bytes: totalBytes, error: "读取 " + key + " 失败" }); next(); return; }
              items.push({ key: key, content: b64, contentType: file.type || "application/octet-stream", binary: true });
              totalBytes += file.size;
              setProg({ done: idx, total: pairs.length, bytes: totalBytes, uploading: false });
              next();
            });
          }
          next();
        } else {
          var pair = pairs[0]; var file = pair.file; var key = pair.key;
          setBusy(true); setProg({ done: 0, total: 1, bytes: 0, uploading: false, name: key });
          toB64(file, function(b64) {
            if (!b64) { setBusy(false); setProg({ error: "读取 " + key + " 失败" }); return; }
            if (pfx) key = pfx.replace(/\/+$/, "") + "/" + key;
            setProg({ done: 1, total: 1, bytes: file.size, uploading: true, name: key });
            conn.rpc.call("/oss", "put", { provider: prov, key: key, content: b64, contentType: file.type || "application/octet-stream", binary: true }).then(function(res) {
              setBusy(false);
              if (res && res.ok) { setProg(null); props.onDone(); }
              else setProg({ error: (res && res.error && res.error.message) || "unknown" });
            }).catch(function(e) { setBusy(false); setProg({ error: String((e && e.message) || e) }); });
          });
        }
      }

      function doText() {
        if (!tKey.trim() || !tTxt) return;
        setBusy(true);
        conn.rpc.call("/oss", "put", { provider: prov, key: tKey.trim(), content: tTxt }).then(function(res) {
          setBusy(false);
          if (res && res.ok) { setProg(null); props.onDone(); }
          else setProg({ error: (res && res.error && res.error.message) || "unknown" });
        }).catch(function(e) { setBusy(false); setProg({ error: String((e && e.message) || e) }); });
      }

      var pct = prog && prog.total ? Math.round(prog.done * 100 / prog.total) : 0;
      var tabStyle = function(active) { return { flex:"1 1 0", padding:"11px 0", border:"0", borderBottom: active ? "2px solid var(--dsw-alias-color-accent, #4a8cff)" : "2px solid transparent", background:"transparent", color: active ? "var(--dsw-alias-color-accent, #4a8cff)" : "var(--dsw-alias-label-secondary, #999)", fontFamily:"inherit", fontSize:"13px", cursor:"pointer", fontWeight: active ? "600" : "400" }; };

      var content;
      if (tab === "file") {
        content = [
          React.createElement("div", { key:"hint", style:{ fontSize:"12px", color:"var(--dsw-alias-label-secondary, #888)", padding:"2px 0", textAlign:"center" } }, "选择文件或文件夹，文件夹上传保留完整目录结构"),
          React.createElement("div", { key:"btns", style: { display:"flex", gap:"10px", flexWrap:"wrap", justifyContent:"center" } },
            React.createElement("label", { key:"ff", style: Object.assign({}, Z.btnPrimary(busy), { display:"inline-block", cursor: busy ? "not-allowed" : "pointer", padding:"12px 28px" }) }, "📤 选择文件",
              React.createElement("input", { type:"file", multiple:true, style:{ display:"none" }, disabled:busy, onChange: function(e){ onPick(e.target.files); e.target.value=""; } })
            ),
            React.createElement("label", { key:"fd", style: Object.assign({}, Z.btnSecondary, { display:"inline-block", cursor: busy ? "not-allowed" : "pointer", padding:"12px 28px", opacity: busy ? 0.6 : 1 }) }, "📁 选择文件夹",
              React.createElement("input", { type:"file", webkitdirectory:"", directory:"", multiple:true, style:{ display:"none" }, disabled:busy, onChange: function(e){ onPick(e.target.files); e.target.value=""; } })
            )
          ),
        ];
      } else {
        content = [
          React.createElement("input", { key:"ik", value:tKey, onChange:function(e){setTKey(e.target.value);}, placeholder:"对象 key (如 logs/2026.txt)", style: { padding:"8px 12px", border:"1px solid var(--dsw-alias-border-l1, #e0e0e0)", borderRadius:"8px", background:"var(--dsw-alias-bg-layer-2, #f5f5f5)", color:"var(--dsw-alias-label-primary, #333)", fontFamily:"inherit", fontSize:"13px" } }),
          React.createElement("textarea", { key:"it", value:tTxt, onChange:function(e){setTTxt(e.target.value);}, placeholder:"文本内容…", rows:4, style: { padding:"8px 12px", border:"1px solid var(--dsw-alias-border-l1, #e0e0e0)", borderRadius:"8px", background:"var(--dsw-alias-bg-layer-2, #f5f5f5)", color:"var(--dsw-alias-label-primary, #333)", fontFamily:"inherit", fontSize:"13px", resize:"vertical" } }),
          React.createElement("button", { key:"ib", type:"button", onClick:doText, disabled:!tKey.trim()||!tTxt||busy, style: Z.btnPrimary(!tKey.trim()||!tTxt||busy) }, "✓ 上传文本"),
        ];
      }

      if (prog) {
        content.push(React.createElement("div", { key:"prog", style: { fontSize:"12px", color:"var(--dsw-alias-label-primary, #333)", padding:"10px 14px", background:"var(--dsw-alias-bg-layer-1, #f7f7f7)", borderRadius:"8px" } },
          prog.error
            ? React.createElement("span", { style: { color:"var(--dsw-alias-color-danger, #d0334b)", whiteSpace:"pre-wrap" } }, "❌ " + prog.error)
            : React.createElement(React.Fragment, null,
                React.createElement("div", { style: { display:"flex", justifyContent:"space-between", marginBottom:"4px" } },
                  React.createElement("span", null, prog.uploading ? (prog.name ? "⬆ " + prog.name : "⬆ 上传中…") : "📖 读取中…"),
                  React.createElement("span", { style: { color:"var(--dsw-alias-label-secondary, #999)" } }, prog.done + "/" + prog.total + " · " + fmtSize(prog.bytes))
                ),
                React.createElement("div", { style: { height:"5px", background:"var(--dsw-alias-bg-layer-2, #e0e0e0)", borderRadius:"3px", overflow:"hidden" } },
                  React.createElement("div", { style: { width:pct+"%", height:"100%", background:"var(--dsw-alias-color-accent, #4a8cff)", transition:"width 0.2s", borderRadius:"3px" } })
                )
              )
        ));
      }

      return React.createElement("div", { onClick: busy ? undefined : props.onClose, style: Z.overlay(1550) },
        React.createElement("div", { onClick: function(e){e.stopPropagation();}, style: Z.card(500, 85) },
          React.createElement("div", { style: Z.header },
            React.createElement("span", { style: Z.headerTitle }, "📤 上传到 " + prov),
            React.createElement("button", { type:"button", onClick: props.onClose, disabled: busy, style: Object.assign({}, Z.closeBtn, { opacity: busy ? 0.3 : 1, cursor: busy ? "not-allowed" : "pointer" }) }, "×")
          ),
          React.createElement("div", { style: { display:"flex", borderBottom:"1px solid var(--dsw-alias-border-l1, #e0e0e0)" } },
            React.createElement("button", { type:"button", onClick: function(){ setTab("file"); }, style: tabStyle(tab === "file") }, "文件 / 文件夹"),
            React.createElement("button", { type:"button", onClick: function(){ setTab("text"); }, style: tabStyle(tab === "text") }, "文本")
          ),
          React.createElement("div", { style: Z.body }, content)
        )
      );
    }

    function OssPanel(props) {
      var conn = props.connection;

      var provsS = React.useState([]); var provs = provsS[0]; var setProvs = provsS[1];
      var actS = React.useState(""); var act = actS[0]; var setAct = actS[1];
      var objsS = React.useState([]); var objs = objsS[0]; var setObjs = objsS[1];
      var dirsS = React.useState([]); var dirs = dirsS[0]; var setDirs = dirsS[1];
      var ldS = React.useState(false); var ld = ldS[0]; var setLd = ldS[1];
      var errS = React.useState(null); var err = errS[0]; var setErr = errS[1];
      var pfxS = React.useState(""); var pfx = pfxS[0]; var setPfx = pfxS[1];
      var vkS = React.useState(null); var vk = vkS[0]; var setVk = vkS[1];
      var vcS = React.useState(""); var vc = vcS[0]; var setVc = vcS[1];
      var busyS = React.useState(false); var busy = busyS[0]; var setBusy = busyS[1];
      var modS = React.useState(null); var mod = modS[0]; var setMod = modS[1];
      var upOpenS = React.useState(false); var upOpen = upOpenS[0]; var setUpOpen = upOpenS[1];

      function confirm(msg, onYes, opts) {
        opts = opts || {};
        setMod({ message: msg, onConfirm: function(){ setMod(null); onYes(); }, onCancel: function(){ setMod(null); }, danger: opts.danger !== false, title: opts.title || "确认" });
      }
      function alert(msg, title) { setMod({ message: msg, onConfirm: function(){ setMod(null); }, title: title || "提示" }); }

      React.useEffect(function() {
        var c = false;
        conn.rpc.call("/oss", "providers", {}).then(function(r) {
          if (c) return;
          if (r && r.ok && Array.isArray(r.value) && r.value.length) { setProvs(r.value); if (!act) setAct(r.value[0].name); }
          else if (r && !r.ok) setErr((r.error && r.error.message) || "load providers failed");
        }).catch(function(e) { if (!c) setErr(String((e && e.message) || e)); });
        return function() { c = true; };
      }, []);

      var refresh = React.useCallback(function(p, px) {
        if (!p) return;
        setLd(true); setErr(null);
        conn.rpc.call("/oss", "list", { provider: p, prefix: px || "" }).then(function(r) {
          setLd(false);
          if (r && r.ok) { setObjs(r.value.objects || []); setDirs(r.value.prefixes || []); }
          else { setErr((r && r.error && r.error.message) || "list failed"); setObjs([]); setDirs([]); }
        }).catch(function(e) { setLd(false); setErr(String((e && e.message) || e)); setObjs([]); setDirs([]); });
      }, [conn]);

      React.useEffect(function() { if (act) refresh(act, pfx); }, [act]);

      function viewObj(key) {
        setBusy(true); setVk(key); setVc("");
        conn.rpc.call("/oss", "getText", { provider: act, key: key }).then(function(r) {
          setBusy(false);
          if (r && r.ok) setVc(r.value.content || "(empty)");
          else setVc("❌ " + ((r && r.error && r.error.message) || "failed"));
        }).catch(function(e) { setBusy(false); setVc("❌ " + String((e && e.message) || e)); });
      }

      function delObj(key) {
        confirm("确定删除 oss://" + act + "/" + key + " ?", function() {
          setBusy(true);
          conn.rpc.call("/oss", "delete", { provider: act, key: key }).then(function(r) {
            setBusy(false);
            if (r && r.ok) refresh(act, pfx);
            else alert("删除失败: " + ((r && r.error && r.error.message) || "unknown"), "删除失败");
          }).catch(function(e) { setBusy(false); alert("删除失败: " + String((e && e.message) || e), "删除失败"); });
        });
      }

      function delFolder(folderPfx) {
        var name = folderPfx; if (pfx && name.indexOf(pfx) === 0) name = name.slice(pfx.length); name = name.replace(/\/+$/, "");
        confirm("确定删除文件夹 " + name + "/ 及其下所有对象?此操作不可恢复。", function() {
          setBusy(true);
          conn.rpc.call("/oss", "deleteFolder", { provider: act, prefix: folderPfx }).then(function(r) {
            setBusy(false);
            if (r && r.ok && r.value) {
              var v = r.value;
              if (v.failed > 0) alert("删除完成: " + v.deleted + " 成功, " + v.failed + " 失败\n" + (v.errors || []).map(function(e) { return e.key + ": " + e.message; }).join("\n"), "删除结果");
              refresh(act, pfx);
            } else alert("删除失败: " + ((r && r.error && r.error.message) || "unknown"), "删除失败");
          }).catch(function(e) { setBusy(false); alert("删除失败: " + String((e && e.message) || e), "删除失败"); });
        }, { title: "删除文件夹" });
      }

      function sb(label, fn, opts) {
        opts = opts || {};
        return React.createElement("button", { type:"button", onClick:fn, disabled:opts.dis||false, style: Object.assign({ padding:"5px 12px", border:"1px solid var(--dsw-alias-border-l1, #e0e0e0)", borderRadius:"8px", background:"var(--dsw-alias-bg-layer-2, #f0f0f0)", color:"var(--dsw-alias-label-primary, #333)", fontFamily:"inherit", fontSize:"12px", cursor: opts.dis ? "not-allowed" : "pointer", whiteSpace:"nowrap", opacity: opts.dis ? 0.5 : 1 }, opts.style) }, label);
      }

      var body = [];

      // Provider + bucket selector — supports multiple providers/buckets.
      var pb = provs.map(function(p) {
        var a = p.name === act;
        return React.createElement("button", { key:p.name, type:"button", onClick: function(){ setAct(p.name); setVk(null); setPfx(""); }, style: { padding:"4px 14px", borderRadius:"8px", fontFamily:"inherit", fontSize:"12px", cursor:"pointer", whiteSpace:"nowrap", border:"1px solid " + (a ? "var(--dsw-alias-color-accent, #4a8cff)" : "var(--dsw-alias-border-l1, #e0e0e0)"), background: a ? "var(--dsw-alias-color-accent, #4a8cff)" : "var(--dsw-alias-bg-layer-2, #f0f0f0)", color: a ? "#fff" : "var(--dsw-alias-label-primary, #333)", display:"flex", alignItems:"center", gap:"4px" } },
          React.createElement("span", null, p.name),
          React.createElement("span", { style: { fontSize:"10px", opacity:0.7 } }, "/" + (p.bucket || "?"))
        );
      });
      body.push(React.createElement("div", { key:"prov", style:{ display:"flex", gap:"6px", alignItems:"center", flexWrap:"wrap" } },
        React.createElement("span", { style:{ fontSize:"12px", color:"var(--dsw-alias-label-secondary, #888)" } }, "Bucket:"),
        pb.length ? pb : React.createElement("span", { style:{ fontSize:"12px", color:"var(--dsw-alias-label-secondary, #888)" } }, "(无 — 检查环境变量)")
      ));

      // Breadcrumb + actions
      var crumbs = [{ label:"根", path:"" }];
      if (pfx) { var pts = pfx.replace(/\/+$/,"").split("/").filter(Boolean); var ac=""; for (var i=0;i<pts.length;i++) { ac=ac?ac+"/"+pts[i]:pts[i]; crumbs.push({label:pts[i], path:ac+"/"}); } }
      var ce = [];
      crumbs.forEach(function(c, ci) {
        if (ci>0) ce.push(React.createElement("span", { key:"s"+ci, style:{ color:"var(--dsw-alias-label-secondary, #ccc)", fontSize:"12px" } }, "/"));
        ce.push(React.createElement("button", { key:"c"+ci, type:"button", onClick: function(){ setPfx(c.path); setVk(null); refresh(act, c.path); }, style: { border:"0", background:"transparent", cursor:"pointer", fontFamily:"inherit", fontSize:"12px", color: ci===crumbs.length-1 ? "var(--dsw-alias-label-primary, #333)" : "var(--dsw-alias-color-accent, #4a8cff)", padding:"1px 3px", whiteSpace:"nowrap" } }, c.label));
      });
      body.push(React.createElement("div", { key:"bar", style:{ display:"flex", gap:"5px", alignItems:"center", marginTop:"8px", flexWrap:"wrap" } },
        React.createElement("span", { style:{ fontSize:"12px", color:"var(--dsw-alias-label-secondary, #888)", flex:"1 1 auto", minWidth:"0", overflow:"hidden" } }, ce),
        sb("🔄", function(){ refresh(act, pfx); }),
        sb("📤 上传", function(){ setUpOpen(true); }, { style:{ background:"var(--dsw-alias-color-accent, #4a8cff)", color:"#fff", borderColor:"transparent", fontWeight:"500" } })
      ));

      if (err) body.push(React.createElement("div", { key:"err", style:{ marginTop:"6px", padding:"8px 12px", color:"var(--dsw-alias-color-danger, #d0334b)", fontSize:"12px", background:"var(--dsw-alias-bg-layer-1, #fff0f0)", borderRadius:"8px", wordBreak:"break-word" } }, "❌ " + err));

      var lc;
      if (ld) {
        lc = React.createElement("div", { style:{ padding:"48px", textAlign:"center", color:"var(--dsw-alias-label-secondary, #999)", fontSize:"13px" } }, "加载中…");
      } else if (vk) {
        lc = React.createElement("div", { style:{ display:"flex", flexDirection:"column", height:"100%" } },
          React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:"8px", padding:"8px 0", borderBottom:"1px solid var(--dsw-alias-border-l1, #f0f0f0)" } },
            React.createElement("span", { style:{ fontSize:"12px", flex:"1 1 auto", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"var(--dsw-alias-label-primary, #333)" } }, "📄 " + vk),
            sb("← 返回", function(){ setVk(null); setVc(""); })
          ),
          React.createElement("pre", { style:{ flex:"1 1 auto", margin:"0", padding:"12px", overflow:"auto", fontFamily:"var(--dsw-alias-font-mono, monospace)", fontSize:"12px", lineHeight:"1.6", color:"var(--dsw-alias-label-primary, #333)", whiteSpace:"pre-wrap", wordBreak:"break-word" } }, busy ? "加载中…" : vc)
        );
      } else if (!objs.length && !dirs.length) {
        lc = React.createElement("div", { style:{ padding:"48px", textAlign:"center", color:"var(--dsw-alias-label-secondary, #999)", fontSize:"13px" } }, "(空)");
      } else {
        var rows = [];
        dirs.forEach(function(sd) {
          var name = sd; if (pfx && sd.indexOf(pfx) === 0) name = sd.slice(pfx.length); name = name.replace(/\/+$/, "");
          rows.push(React.createElement("div", { key:"d:"+sd, style:{ display:"flex", alignItems:"center", gap:"8px", padding:"9px 12px", borderBottom:"1px solid var(--dsw-alias-border-l1, #f0f0f0)" } },
            React.createElement("span", { style:{ fontSize:"16px", flex:"0 0 auto", cursor:"pointer" }, onClick: function(){ setPfx(sd); setVk(null); refresh(act, sd); } }, "📁"),
            React.createElement("button", { type:"button", onClick: function(){ setPfx(sd); setVk(null); refresh(act, sd); }, title:sd, style:{ flex:"1 1 auto", minWidth:"0", textAlign:"left", border:"0", background:"transparent", cursor:"pointer", color:"var(--dsw-alias-color-accent, #4a8cff)", fontFamily:"inherit", fontSize:"12px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontWeight:"500" } }, name + "/"),
            sb("🗑", function(){ delFolder(sd); }, { dis:busy, style:{ flex:"0 0 auto", padding:"3px 8px", border:"0", borderRadius:"6px", background:"transparent", color:"var(--dsw-alias-color-danger, #d0334b)", fontSize:"14px", cursor: busy?"wait":"pointer" } })
          ));
        });
        objs.forEach(function(o) {
          rows.push(React.createElement("div", { key:o.key, style:{ display:"flex", alignItems:"center", gap:"8px", padding:"9px 12px", borderBottom:"1px solid var(--dsw-alias-border-l1, #f0f0f0)" } },
            React.createElement("span", { style:{ fontSize:"16px", flex:"0 0 auto" } }, fIcon(o.key)),
            React.createElement("button", { type:"button", onClick: function(){ viewObj(o.key); }, title:o.key, style:{ flex:"1 1 auto", minWidth:"0", textAlign:"left", border:"0", background:"transparent", cursor:"pointer", color:"var(--dsw-alias-label-primary, #333)", fontFamily:"inherit", fontSize:"12px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, o.key),
            React.createElement("span", { style:{ flex:"0 0 auto", fontSize:"11px", color:"var(--dsw-alias-label-secondary, #aaa)" } }, fmtSize(o.size)),
            React.createElement("span", { style:{ flex:"0 0 auto", fontSize:"11px", color:"var(--dsw-alias-label-secondary, #aaa)" } }, relTime(o.lastModified)),
            sb("🗑", function(){ delObj(o.key); }, { dis:busy, style:{ flex:"0 0 auto", padding:"3px 8px", border:"0", borderRadius:"6px", background:"transparent", color:"var(--dsw-alias-color-danger, #d0334b)", fontSize:"14px", cursor: busy?"wait":"pointer" } })
          ));
        });
        lc = React.createElement("div", { style:{ overflowY:"auto", flex:"1 1 auto" } }, rows);
      }
      body.push(React.createElement("div", { key:"list", style:{ flex:"1 1 auto", overflow:"hidden", marginTop:"6px", display:"flex", flexDirection:"column", minHeight:"120px" } }, lc));

      return React.createElement("div", { style: Z.card(720, 84) },
        React.createElement("div", { style: Z.header },
          React.createElement("span", { style: Z.headerTitle }, "☁ OSS 文件浏览"),
          React.createElement("button", { type:"button", onClick: props.onClose, style: Z.closeBtn }, "×")
        ),
        React.createElement("div", { style: Z.body }, body),
        mod ? React.createElement(ModalDialog, mod) : null,
        upOpen ? React.createElement(UploadDialog, { connection: conn, provider: act, prefix: pfx, onClose: function(){ setUpOpen(false); }, onDone: function(){ setUpOpen(false); refresh(act, pfx); } }) : null
      );
    }

    function OssTrigger(p) {
      return React.createElement("button", { type:"button", onClick:p.onToggle, title:"OSS 对象存储", style:{ position:"fixed", left:"10px", bottom:"64px", zIndex:1300, height:"38px", padding:"0 14px", boxSizing:"border-box", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:"6px", border:"1px solid var(--dsw-alias-border-l1, #e0e0e0)", cursor:"pointer", background:"var(--dsw-alias-bg-layer-1, #fff)", color:"var(--dsw-alias-label-secondary, #666)", fontFamily:"inherit", fontSize:"12px", borderRadius:"10px", whiteSpace:"nowrap" } },
        React.createElement("span", { style:{ fontSize:"14px" } }, "☁"), React.createElement("span", null, "OSS"));
    }

    function apply(ctx) {
      ctx.inject(["slots","connection"], function(scope) {
        var conn = scope.connection;
        scope.slots.inject("shell.overlay", function() {
          return scope.slots.register({ name:"shell.overlay", id:"dsh-oss-browser", order:10, label:"OSS" }, function() {
            var oS = React.useState(false); var o = oS[0]; var so = oS[1];
            if (!o) return React.createElement(OssTrigger, { onToggle: function(){ so(true); } });
            return React.createElement(React.Fragment, null,
              React.createElement(OssTrigger, { onToggle: function(){ so(false); } }),
              React.createElement("div", { onClick: function(){ so(false); }, style: Z.overlay(1450) },
                React.createElement("div", { onClick: function(e){ e.stopPropagation(); }, style: { maxWidth:"100%", maxHeight:"100%" } },
                  React.createElement(OssPanel, { connection: conn, onClose: function(){ so(false); } })
                )
              )
            );
          });
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
