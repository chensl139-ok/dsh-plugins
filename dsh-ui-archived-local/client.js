/**
 * Archived-sessions panel, local override of ui-archived. Same UI as the
 * shipped version, but replaces window.confirm / window.alert with a centered
 * custom ModalDialog. Registered on shell.overlay with id "dsh-archived"
 * (same id, so it replaces the shipped occupant when that is disabled).
 */
window.__ModuleLoader__.load({
  id: "dsh-ui-archived-local",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");

    var inject = ["sessions", "workspaces"];

    /** A centered modal dialog (confirm or alert). */
    function ModalDialog(props) {
      var isAlert = !props.onCancel;
      return react.createElement("div", {
        onClick: isAlert ? undefined : props.onCancel,
        style: {
          position: "fixed", inset: "0", zIndex: 1400,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,.4)",
        },
      }, react.createElement("div", {
        onClick: function (e) { e.stopPropagation(); },
        style: {
          background: "var(--dsw-alias-bg-overlay)",
          border: "1px solid var(--dsw-alias-border-l1)",
          borderRadius: "12px",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
          maxWidth: "min(420px, calc(100vw - 32px))",
          maxHeight: "calc(80vh - 32px)",
          overflow: "auto",
          display: "flex", flexDirection: "column",
        },
      },
        react.createElement("div", {
          style: { padding: "16px 20px 8px", fontSize: "14px", fontWeight: "600", color: "var(--dsw-alias-label-primary)" },
        }, props.title || (isAlert ? "提示" : "确认")),
        react.createElement("div", {
          style: { padding: "0 20px 16px", fontSize: "13px", color: "var(--dsw-alias-label-secondary)", lineHeight: "1.6", wordBreak: "break-word", whiteSpace: "pre-wrap" },
        }, props.message),
        react.createElement("div", {
          style: { display: "flex", gap: "8px", justifyContent: "flex-end", padding: "0 16px 16px" },
        },
          isAlert ? null : react.createElement("button", {
            type: "button", onClick: props.onCancel,
            style: {
              padding: "6px 16px", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: "8px",
              background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)",
              fontFamily: "inherit", fontSize: "13px", cursor: "pointer",
            },
          }, props.cancelLabel || "取消"),
          react.createElement("button", {
            type: "button", onClick: props.onConfirm,
            style: {
              padding: "6px 16px", border: "1px solid transparent", borderRadius: "8px",
              background: props.danger ? "var(--dsw-alias-color-danger, #d0334b)" : "var(--dsw-alias-color-accent, #4a8cff)",
              color: "#fff", fontFamily: "inherit", fontSize: "13px", cursor: "pointer",
            },
          }, props.confirmLabel || (isAlert ? "知道了" : "确定"))
        )
      ));
    }

    function relTime(ts) {
      var d = Date.now() - ts;
      if (d < 60000) return "刚刚";
      var m = Math.floor(d / 60000);
      if (m < 60) return m + " 分钟前";
      var h = Math.floor(m / 60);
      if (h < 24) return h + " 小时前";
      return Math.floor(h / 24) + " 天前";
    }

    function workspaceTitleOf(workspaces, sessionId) {
      var items = (workspaces && workspaces.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].sessionIds.indexOf(sessionId) >= 0) return items[i].title || "未分组";
      }
      return "未分组";
    }

    function ArchivedRow(props) {
      return react.createElement("div", {
        key: props.id,
        style: { display: "flex", alignItems: "center", gap: "6px", width: "100%" },
      },
        react.createElement("button", {
          type: "button",
          onClick: function () { props.onOpen(props.id); },
          title: props.title,
          style: {
            display: "flex", flexDirection: "column", gap: "2px",
            flex: "1 1 auto", minWidth: "0", padding: "8px 10px",
            border: "0", borderRadius: "8px", background: "transparent", cursor: "pointer", textAlign: "left",
          },
        },
          react.createElement("span", { style: { color: "var(--dsw-alias-label-primary)", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, props.title),
          react.createElement("span", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, props.meta)
        ),
        react.createElement("button", {
          type: "button", onClick: function () { props.onUnarchive(props.id); },
          title: "取消归档", "aria-label": "取消归档",
          style: { flex: "0 0 auto", padding: "4px 7px", border: "0", borderRadius: "6px", cursor: "pointer", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-secondary)", fontFamily: "inherit", fontSize: "11px", whiteSpace: "nowrap" },
        }, "取消归档"),
        react.createElement("button", {
          type: "button", onClick: function () { props.onDelete(props.id); },
          title: "删除", "aria-label": "删除",
          style: { flex: "0 0 auto", padding: "4px 7px", border: "0", borderRadius: "6px", cursor: "pointer", background: "transparent", color: "var(--dsw-alias-color-danger, #d0334b)", fontFamily: "inherit", fontSize: "13px", lineHeight: "1", whiteSpace: "nowrap" },
        }, "🗑")
      );
    }

    function ArchivedPanel(props) {
      var openListState = react.useState(false);
      var openList = openListState[0];
      var setOpenList = openListState[1];

      var sidebarWidthState = react.useState(280);
      var sidebarWidth = sidebarWidthState[0];
      var setSidebarWidth = sidebarWidthState[1];

      // Modal state for delete confirmation / error alert.
      var modalState = react.useState(null);
      var modal = modalState[0];
      var setModal = modalState[1];

      react.useEffect(function () {
        var column = document.querySelector("[data-slot=\"sidebar\"]");
        if (column) column = column.parentElement;
        if (!column) return;
        var update = function () {
          var w = column.getBoundingClientRect().width;
          if (w > 0) setSidebarWidth(w);
        };
        update();
        var observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : undefined;
        if (observer) observer.observe(column);

        // Listen for delete errors dispatched by doDelete (runs outside render).
        var onError = function (e) {
          setModal({
            title: "删除失败",
            message: e.detail || "未知错误",
            onConfirm: function () { setModal(null); },
          });
        };
        window.addEventListener("dsh-archived-delete-error", onError);

        return function () {
          if (observer) observer.disconnect();
          window.removeEventListener("dsh-archived-delete-error", onError);
        };
      }, []);

      var rows = [];
      var workspaces;
      try {
        workspaces = props.useWorkspaces(function (s) { return s; });
        var list = props.useSessions(function (s) { return s; });
        var archivedIds = (workspaces && workspaces.archivedSessionIds) || [];
        var byId = (list && list.byId) || {};
        rows = archivedIds.map(function (id) { return byId[id]; }).filter(function (s) { return s !== undefined; }).map(function (s) {
          return { id: s.id, title: s.displayTitle || String(s.id), updatedAt: s.updatedAt || 0 };
        });
      } catch (e) {
        console.error("archived data:", e);
      }

      var openSession = function (id) {
        props.open(id);
        setOpenList(false);
      };

      // Delete with centered custom modal (replaces window.confirm).
      var handleDelete = function (id) {
        setModal({
          title: "确认删除",
          message: "确定删除该已归档会话?此操作将永久删除会话记录,不可恢复。",
          danger: true,
          onConfirm: function () {
            setModal(null);
            props.doDelete(id);
          },
          onCancel: function () { setModal(null); },
        });
      };

      var trigger = react.createElement("button", {
        type: "button", "data-archived-mounted": "1",
        onClick: function () { setOpenList(function (v) { return !v; }); },
        "aria-expanded": openList,
        title: "已归档会话 " + String(rows.length),
        style: {
          position: "fixed", left: "10px", bottom: "112px", zIndex: 1300,
          height: "38px", padding: "0 12px", boxSizing: "border-box",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px",
          border: "1px solid var(--dsw-alias-border-l1)", cursor: "pointer",
          background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-secondary)",
          fontFamily: "inherit", fontSize: "12px", borderRadius: "8px", whiteSpace: "nowrap",
        },
      },
        react.createElement("span", { style: { fontSize: "14px", lineHeight: "1" } }, "🗂"),
        react.createElement("span", { style: { lineHeight: "1" } }, "已归档"),
        react.createElement("span", { style: { fontSize: "11px", opacity: ".7" } }, String(rows.length))
      );

      if (!openList) {
        return react.createElement(react.Fragment, null, trigger, modal ? react.createElement(ModalDialog, modal) : null);
      }

      var body = [];
      if (rows.length === 0) {
        body.push(react.createElement("div", { style: { padding: "18px 12px", textAlign: "center", color: "var(--dsw-alias-label-secondary)", fontSize: "13px" } }, "暂无归档会话"));
      } else {
        for (var i = 0; i < rows.length; i++) {
          var s = rows[i];
          var meta = workspaceTitleOf(workspaces, s.id) + " · " + relTime(s.updatedAt);
          body.push(react.createElement(ArchivedRow, {
            key: s.id, id: s.id, title: s.title, meta: meta,
            onOpen: openSession, onUnarchive: props.onUnarchive, onDelete: handleDelete,
          }));
        }
      }

      return react.createElement(react.Fragment, null, trigger,
        react.createElement("div", {
          onClick: function () { setOpenList(false); },
          style: { position: "fixed", inset: "0", zIndex: 1250, background: "rgba(0,0,0,.35)" },
        }, react.createElement("div", {
          onClick: function (e) { e.stopPropagation(); },
          style: {
            position: "fixed", left: "10px", bottom: "158px",
            width: Math.min(Math.max(sidebarWidth - 20, 240), 420) + "px",
            maxWidth: "calc(100vw - 24px)", maxHeight: "min(64vh, 560px)", overflow: "auto",
            background: "var(--dsw-alias-bg-overlay)", border: "1px solid var(--dsw-alias-border-l1)",
            borderRadius: "12px", boxShadow: "0 10px 34px rgba(0,0,0,.22)", zIndex: 1310,
          },
        },
          react.createElement("div", {
            style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--dsw-alias-border-l1)", color: "var(--dsw-alias-label-primary)", fontWeight: "600", fontSize: "14px" },
          },
            react.createElement("span", null, "已归档会话"),
            react.createElement("button", {
              type: "button", onClick: function () { setOpenList(false); }, "aria-label": "关闭",
              style: { border: "0", background: "transparent", color: "var(--dsw-alias-label-secondary)", fontSize: "18px", lineHeight: "1", cursor: "pointer", padding: "0 4px", borderRadius: "6px" },
            }, "×")
          ),
          react.createElement("div", { style: { padding: "6px" } }, body)
        )),
        modal ? react.createElement(ModalDialog, modal) : null
      );
    }

    function apply(ctx) {
      ctx.inject(["slots", "workspaces"], function (scope) {
        var sessions = scope.sessions;
        var workspaces = scope.workspaces;
        scope.slots.inject("shell.overlay", function () {
          return scope.slots.register({
            name: "shell.overlay",
            id: "dsh-archived",
            order: 0,
            label: "已归档",
          }, function (props) {
            var open = function (id) { sessions.open(id); };
            var unarchive = function (id) { workspaces.unarchiveSession(id); };
            // The actual delete — ArchivedPanel shows the confirm modal first,
            // then calls this on confirm. Errors show as a centered alert modal.
            var doDelete = function (id) {
              workspaces.deleteSession(id).then(function () {}).catch(function (e) {
                console.error("archived delete failed:", e);
                // Error alert is shown inside ArchivedPanel via its modal state.
                // But doDelete runs outside ArchivedPanel's render scope, so we
                // use a simple fallback: dispatch a CustomEvent the panel listens for.
                window.dispatchEvent(new CustomEvent("dsh-archived-delete-error", {
                  detail: e instanceof Error ? e.message : String(e),
                }));
              });
            };
            return react.createElement(ArchivedPanel, Object.assign({}, props, {
              open: open,
              onUnarchive: unarchive,
              doDelete: doDelete,
            }));
          });
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
