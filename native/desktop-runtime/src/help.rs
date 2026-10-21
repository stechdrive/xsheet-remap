use tauri::Manager;

const WINDOW_LABEL: &str = "help";

#[derive(serde::Deserialize)]
pub(super) struct HelpLocation {
    topic: String,
    view: String,
    chapter: Option<String>,
}

impl HelpLocation {
    fn query(&self) -> Result<String, String> {
        if !matches!(self.topic.as_str(), "sheet" | "clip" | "template")
            || !matches!(self.view.as_str(), "quick" | "detailed" | "licenses")
        {
            return Err("ヘルプの表示先が不正です。".into());
        }
        let mut url = tauri::Url::parse("tauri://localhost/index.html")
            .map_err(|error| error.to_string())?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("app", "help");
            query.append_pair("topic", &self.topic);
            query.append_pair("view", &self.view);
            if let Some(chapter) = &self.chapter {
                query.append_pair("chapter", chapter);
            }
        }
        Ok(url.query().unwrap_or_default().to_owned())
    }
}

#[tauri::command]
pub(super) async fn open_help_window(
    app: tauri::AppHandle,
    location: HelpLocation,
) -> Result<(), String> {
    let query = location.query()?;
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let mut url = window.url().map_err(|error| error.to_string())?;
        url.set_query(Some(&query));
        url.set_fragment(None);
        window.navigate(url).map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        WINDOW_LABEL,
        tauri::WebviewUrl::App(format!("index.html?{query}").into()),
    )
    .title("xsheet-remap ヘルプ")
    .inner_size(1060.0, 820.0)
    .min_inner_size(390.0, 600.0)
    .disable_drag_drop_handler()
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_location_keeps_chapter_text_inside_its_parameter() {
        let location = HelpLocation {
            topic: "template".into(),
            view: "detailed".into(),
            chapter: Some("save&app=remap#other".into()),
        };
        let url = tauri::Url::parse(&format!("tauri://localhost/index.html?{}", location.query().unwrap())).unwrap();
        let values: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(values.get("app").unwrap(), "help");
        assert_eq!(values.get("chapter").unwrap(), "save&app=remap#other");
        assert_eq!(url.fragment(), None);
    }

    #[test]
    fn help_location_rejects_unknown_topics_and_views() {
        for (topic, view) in [("corrector", "quick"), ("sheet", "unknown")] {
            let location = HelpLocation { topic: topic.into(), view: view.into(), chapter: None };
            assert!(location.query().is_err());
        }
    }
}
