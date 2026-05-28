use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use crate::{PdfKitAnnotationSyncDto, PdfKitAnnotationSyncRequest};

// Keep managed copies in an app-owned directory so persisted paths cannot drive native writes.
fn managed_pdf_path(
    source_path: &Path,
    managed_copy_path: Option<&str>,
    managed_copy_dir: &Path,
) -> Result<PathBuf, String> {
    let managed_copy_dir = absolute_managed_copy_dir(managed_copy_dir)?;
    ensure_managed_copy_dir_available(&managed_copy_dir)?;
    if let Some(path) = managed_copy_path
        .map(PathBuf::from)
        .filter(|path| is_safe_managed_pdf_path(path, &managed_copy_dir))
    {
        return Ok(path);
    }

    let file_stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(safe_managed_pdf_stem)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "document".to_string());
    Ok(managed_copy_dir.join(format!(
        "smartreader-pdfkit-managed-{}-{:016x}.pdf",
        file_stem,
        stable_source_path_hash(source_path)
    )))
}

fn absolute_managed_copy_dir(managed_copy_dir: &Path) -> Result<PathBuf, String> {
    if managed_copy_dir.as_os_str().is_empty() {
        return Err("PDFKit managed copy directory is unavailable".to_string());
    }
    if managed_copy_dir.is_absolute() {
        Ok(managed_copy_dir.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|current_dir| current_dir.join(managed_copy_dir))
            .map_err(|_| "PDFKit managed copy directory is unavailable".to_string())
    }
}

fn ensure_managed_copy_dir_available(managed_copy_dir: &Path) -> Result<(), String> {
    match fs::symlink_metadata(managed_copy_dir) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("PDFKit managed copy directory is unavailable".to_string());
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("PDFKit managed copy directory is unavailable".to_string()),
    }
}

fn is_safe_managed_pdf_path(path: &Path, managed_copy_dir: &Path) -> bool {
    path.is_absolute()
        && path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false)
        && !path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        && path.starts_with(managed_copy_dir)
        && has_safe_managed_pdf_parent(path, managed_copy_dir)
        && is_regular_file_or_missing(path)
}

fn has_safe_managed_pdf_parent(path: &Path, managed_copy_dir: &Path) -> bool {
    let Ok(root_metadata) = fs::symlink_metadata(managed_copy_dir) else {
        return false;
    };
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return false;
    }
    let Ok(canonical_root) = fs::canonicalize(managed_copy_dir) else {
        return false;
    };
    let Some(parent) = path.parent() else {
        return false;
    };
    let Ok(relative_parent) = parent.strip_prefix(managed_copy_dir) else {
        return false;
    };

    let mut current = managed_copy_dir.to_path_buf();
    let mut existing_parent = managed_copy_dir.to_path_buf();
    for component in relative_parent.components() {
        let Component::Normal(name) = component else {
            return false;
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return false;
                }
                existing_parent = current.clone();
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return false,
        }
    }

    fs::canonicalize(existing_parent)
        .map(|parent| parent.starts_with(canonical_root))
        .unwrap_or(false)
}

fn is_regular_file_or_missing(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(metadata) => !metadata.file_type().is_symlink() && metadata.is_file(),
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
    }
}

fn safe_managed_pdf_stem(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn stable_source_path_hash(source_path: &Path) -> u64 {
    let source_path = source_path
        .canonicalize()
        .unwrap_or_else(|_| source_path.to_path_buf());
    let mut hash = 0xcbf29ce484222325u64;
    for byte in source_path.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }

    hash
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    use objc2::{rc::autoreleasepool, AnyThread};
    use objc2_app_kit::NSColor;
    use objc2_core_foundation::{CGFloat, CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSArray, NSString, NSValue, NSURL};
    use objc2_pdf_kit::{
        PDFAnnotation, PDFAnnotationSubtypeHighlight, PDFAnnotationSubtypeSquare,
        PDFAnnotationSubtypeStrikeOut, PDFAnnotationSubtypeText, PDFAnnotationSubtypeUnderline,
        PDFBorder, PDFBorderStyle, PDFDocument,
    };

    use crate::{
        parse_pdf_annotation_color, PdfAnnotationKind, PdfAnnotationRect,
        PdfKitAnnotationOperation, PdfKitAnnotationSyncDto, PdfKitAnnotationSyncItem,
        PdfKitAnnotationSyncItemDto, PdfKitAnnotationSyncRequest, ENCRYPTED_DOCUMENT_ERROR,
    };

    const SMARTREADER_PDFKIT_USER_PREFIX: &str = "smartreader:";

    pub(crate) fn sync_pdfkit_annotations_from_path(
        document_path: PathBuf,
        request: PdfKitAnnotationSyncRequest,
        managed_copy_dir: PathBuf,
    ) -> Result<PdfKitAnnotationSyncDto, String> {
        autoreleasepool(|_| {
            sync_pdfkit_annotations_inner(&document_path, request, &managed_copy_dir)
        })
    }

    fn sync_pdfkit_annotations_inner(
        source_path: &Path,
        request: PdfKitAnnotationSyncRequest,
        managed_copy_dir: &Path,
    ) -> Result<PdfKitAnnotationSyncDto, String> {
        let source_path_string = source_path.to_string_lossy().into_owned();
        let managed_copy_path = super::managed_pdf_path(
            source_path,
            request.managed_copy_path.as_deref(),
            managed_copy_dir,
        )?;
        let managed_copy_path_string = managed_copy_path.to_string_lossy().into_owned();
        prepare_managed_pdf_copy(source_path, &managed_copy_path)?;

        let ns_path = NSString::from_str(&managed_copy_path_string);
        let url = NSURL::fileURLWithPath(&ns_path);
        let document = unsafe { PDFDocument::initWithURL(PDFDocument::alloc(), &url) }
            .ok_or_else(|| "PDFKit could not open this PDF document.".to_string())?;
        if unsafe { document.isEncrypted() } || unsafe { document.isLocked() } {
            return Err(ENCRYPTED_DOCUMENT_ERROR.to_string());
        }

        let page_count = unsafe { document.pageCount() };
        for annotation in &request.annotations {
            if annotation.page > page_count {
                return Err("Invalid PDF annotation page".to_string());
            }
        }

        remove_smartreader_annotations(&document, &request)?;

        let mut annotations = Vec::new();
        for annotation in &request.annotations {
            match annotation.operation {
                PdfKitAnnotationOperation::Delete => {
                    annotations.push(PdfKitAnnotationSyncItemDto {
                        id: annotation.id.clone(),
                        status: "deleted".to_string(),
                        page: annotation.page,
                        kind: annotation.kind,
                        native_id: smartreader_native_id(&annotation.id),
                        reason: None,
                    });
                }
                PdfKitAnnotationOperation::Upsert => {
                    add_smartreader_annotation(&document, annotation)?;
                    annotations.push(PdfKitAnnotationSyncItemDto {
                        id: annotation.id.clone(),
                        status: "upserted".to_string(),
                        page: annotation.page,
                        kind: annotation.kind,
                        native_id: smartreader_native_id(&annotation.id),
                        reason: None,
                    });
                }
            }
        }

        if !unsafe { document.writeToURL(&url) } {
            return Err("PDFKit could not write annotation output.".to_string());
        }

        Ok(PdfKitAnnotationSyncDto {
            supported: true,
            status: "synced".to_string(),
            source_path: source_path_string,
            managed_copy_path: managed_copy_path_string,
            annotations,
        })
    }

    fn prepare_managed_pdf_copy(
        source_path: &Path,
        managed_copy_path: &Path,
    ) -> Result<(), String> {
        if source_path == managed_copy_path {
            return Err("PDFKit managed copy path must differ from source path".to_string());
        }
        match fs::symlink_metadata(managed_copy_path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err("PDFKit could not prepare annotation output.".to_string());
                }
                return Ok(());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("PDFKit could not prepare annotation output.".to_string()),
        }
        if let Some(parent) = managed_copy_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| "PDFKit could not prepare annotation output.".to_string())?;
        }
        fs::copy(source_path, managed_copy_path)
            .map_err(|_| "PDFKit could not prepare annotation output.".to_string())?;

        Ok(())
    }

    fn remove_smartreader_annotations(
        document: &PDFDocument,
        request: &PdfKitAnnotationSyncRequest,
    ) -> Result<(), String> {
        let page_count = unsafe { document.pageCount() };
        for page_index in 0..page_count {
            let page = unsafe { document.pageAtIndex(page_index) }
                .ok_or_else(|| "Invalid PDF annotation page".to_string())?;
            let annotations = unsafe { page.annotations() };
            let to_remove = annotations
                .iter()
                .filter(|annotation| {
                    smartreader_annotation_id(annotation)
                        .map(|id| request.annotations.iter().any(|item| item.id == id))
                        .unwrap_or(false)
                })
                .collect::<Vec<_>>();
            for annotation in to_remove {
                unsafe {
                    page.removeAnnotation(&annotation);
                }
            }
        }

        Ok(())
    }

    fn add_smartreader_annotation(
        document: &PDFDocument,
        item: &PdfKitAnnotationSyncItem,
    ) -> Result<(), String> {
        let page = unsafe { document.pageAtIndex(item.page - 1) }
            .ok_or_else(|| "Invalid PDF annotation page".to_string())?;
        let bounds = bounds_for_rects(&item.rects)?;
        let annotation = unsafe {
            PDFAnnotation::initWithBounds_forType_withProperties(
                PDFAnnotation::alloc(),
                bounds,
                pdf_annotation_subtype(item.kind),
                None,
            )
        };
        let color = parse_pdf_annotation_color(&item.color)?;
        let native_color = NSColor::colorWithRed_green_blue_alpha(
            color.red as CGFloat,
            color.green as CGFloat,
            color.blue as CGFloat,
            color.alpha as CGFloat,
        );
        let user_name = NSString::from_str(&smartreader_native_id(&item.id));
        unsafe {
            annotation.setUserName(Some(&user_name));
            annotation.setColor(&native_color);
            annotation.setShouldDisplay(true);
            annotation.setShouldPrint(true);
        }
        if let Some(thickness) = item.thickness {
            let border = unsafe { PDFBorder::new() };
            unsafe {
                border.setStyle(PDFBorderStyle::Solid);
                border.setLineWidth(thickness as CGFloat);
                annotation.setBorder(Some(&border));
            }
        }
        if let Some(note) = item.note.as_deref() {
            let contents = NSString::from_str(note);
            unsafe {
                annotation.setContents(Some(&contents));
            }
        }
        if matches!(
            item.kind,
            PdfAnnotationKind::Highlight | PdfAnnotationKind::Underline | PdfAnnotationKind::Strike
        ) {
            let quad_points = quad_points_for_rects(&item.rects);
            unsafe {
                annotation.setQuadrilateralPoints(Some(&quad_points));
            }
        }
        unsafe {
            page.addAnnotation(&annotation);
        }

        Ok(())
    }

    fn smartreader_annotation_id(annotation: &PDFAnnotation) -> Option<String> {
        let user_name = unsafe { annotation.userName() }?;
        let user_name = user_name.to_string();

        user_name
            .strip_prefix(SMARTREADER_PDFKIT_USER_PREFIX)
            .map(str::to_string)
    }

    fn smartreader_native_id(id: &str) -> String {
        format!("{SMARTREADER_PDFKIT_USER_PREFIX}{id}")
    }

    fn bounds_for_rects(rects: &[PdfAnnotationRect]) -> Result<CGRect, String> {
        let first = rects
            .first()
            .ok_or_else(|| "Invalid PDF annotation rect".to_string())?;
        let mut min_x = first.x;
        let mut min_y = first.y;
        let mut max_x = first.x + first.width;
        let mut max_y = first.y + first.height;

        for rect in rects.iter().skip(1) {
            min_x = min_x.min(rect.x);
            min_y = min_y.min(rect.y);
            max_x = max_x.max(rect.x + rect.width);
            max_y = max_y.max(rect.y + rect.height);
        }

        Ok(CGRect::new(
            CGPoint::new(min_x as CGFloat, min_y as CGFloat),
            CGSize::new((max_x - min_x) as CGFloat, (max_y - min_y) as CGFloat),
        ))
    }

    fn quad_points_for_rects(rects: &[PdfAnnotationRect]) -> objc2::rc::Retained<NSArray<NSValue>> {
        let points = rects
            .iter()
            .flat_map(|rect| {
                [
                    CGPoint::new(rect.x as CGFloat, (rect.y + rect.height) as CGFloat),
                    CGPoint::new(
                        (rect.x + rect.width) as CGFloat,
                        (rect.y + rect.height) as CGFloat,
                    ),
                    CGPoint::new(rect.x as CGFloat, rect.y as CGFloat),
                    CGPoint::new((rect.x + rect.width) as CGFloat, rect.y as CGFloat),
                ]
            })
            .map(|point| unsafe { NSValue::valueWithPoint(point) })
            .collect::<Vec<_>>();

        NSArray::from_retained_slice(&points)
    }

    fn pdf_annotation_subtype(
        kind: PdfAnnotationKind,
    ) -> &'static objc2_pdf_kit::PDFAnnotationSubtype {
        match kind {
            PdfAnnotationKind::Area => unsafe { PDFAnnotationSubtypeSquare },
            PdfAnnotationKind::Note => unsafe { PDFAnnotationSubtypeText },
            PdfAnnotationKind::Highlight => unsafe { PDFAnnotationSubtypeHighlight },
            PdfAnnotationKind::Underline => unsafe { PDFAnnotationSubtypeUnderline },
            PdfAnnotationKind::Strike => unsafe { PDFAnnotationSubtypeStrikeOut },
            PdfAnnotationKind::Wavy | PdfAnnotationKind::RedText => unsafe {
                PDFAnnotationSubtypeSquare
            },
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::path::PathBuf;

    use crate::{
        PdfKitAnnotationSyncDto, PdfKitAnnotationSyncItemDto, PdfKitAnnotationSyncRequest,
    };

    pub(crate) fn sync_pdfkit_annotations_from_path(
        document_path: PathBuf,
        request: PdfKitAnnotationSyncRequest,
        managed_copy_dir: PathBuf,
    ) -> Result<PdfKitAnnotationSyncDto, String> {
        let managed_copy_path = super::managed_pdf_path(
            &document_path,
            request.managed_copy_path.as_deref(),
            &managed_copy_dir,
        )?;
        Ok(PdfKitAnnotationSyncDto {
            supported: false,
            status: "unsupported-platform".to_string(),
            source_path: document_path.to_string_lossy().into_owned(),
            managed_copy_path: managed_copy_path.to_string_lossy().into_owned(),
            annotations: request
                .annotations
                .into_iter()
                .map(|annotation| PdfKitAnnotationSyncItemDto {
                    id: annotation.id,
                    status: "unsupported-platform".to_string(),
                    page: annotation.page,
                    kind: annotation.kind,
                    native_id: String::new(),
                    reason: Some("unsupported-platform".to_string()),
                })
                .collect(),
        })
    }
}

pub(crate) fn sync_pdfkit_annotations_from_path(
    document_path: PathBuf,
    request: PdfKitAnnotationSyncRequest,
    managed_copy_dir: PathBuf,
) -> Result<PdfKitAnnotationSyncDto, String> {
    platform::sync_pdfkit_annotations_from_path(document_path, request, managed_copy_dir)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::managed_pdf_path;

    #[test]
    fn managed_pdf_path_ignores_hostile_provided_pdf_path() {
        let source_path = PathBuf::from("/Users/test/Documents/source.pdf");
        let managed_copy_dir = std::env::temp_dir().join("smartreader-managed-copy-test-root");
        let hostile_path = std::env::temp_dir().join("smartreader-victim.pdf");

        let resolved =
            managed_pdf_path(&source_path, hostile_path.to_str(), &managed_copy_dir).unwrap();

        assert!(resolved.starts_with(&managed_copy_dir));
        assert_ne!(resolved, hostile_path);
        assert_eq!(
            resolved.extension().and_then(|value| value.to_str()),
            Some("pdf")
        );
    }

    #[test]
    fn managed_pdf_path_reuses_safe_provided_pdf_path() {
        let source_path = PathBuf::from("/Users/test/Documents/source.pdf");
        let managed_copy_dir = unique_test_dir("safe-root");
        fs::create_dir_all(&managed_copy_dir).unwrap();
        let safe_path = managed_copy_dir.join("existing-managed.pdf");

        let resolved =
            managed_pdf_path(&source_path, safe_path.to_str(), &managed_copy_dir).unwrap();

        assert_eq!(resolved, safe_path);
        fs::remove_dir_all(&managed_copy_dir).unwrap();
    }

    #[test]
    fn managed_pdf_path_is_deterministic_when_no_safe_path_is_provided() {
        let source_path = PathBuf::from("/Users/test/Documents/source.pdf");
        let managed_copy_dir = std::env::temp_dir().join("smartreader-managed-copy-test-root");

        let first = managed_pdf_path(&source_path, None, &managed_copy_dir).unwrap();
        let second = managed_pdf_path(&source_path, None, &managed_copy_dir).unwrap();

        assert_eq!(first, second);
        assert!(first.starts_with(&managed_copy_dir));
    }

    #[cfg(unix)]
    #[test]
    fn managed_pdf_path_rejects_symlinked_ancestor() {
        use std::os::unix::fs::symlink;

        let source_path = PathBuf::from("/Users/test/Documents/source.pdf");
        let managed_copy_dir = unique_test_dir("symlink-root");
        let outside_dir = unique_test_dir("symlink-outside");
        fs::create_dir_all(&managed_copy_dir).unwrap();
        fs::create_dir_all(&outside_dir).unwrap();
        let linked_dir = managed_copy_dir.join("linked");
        if symlink(&outside_dir, &linked_dir).is_err() {
            fs::remove_dir_all(&managed_copy_dir).unwrap();
            fs::remove_dir_all(&outside_dir).unwrap();
            return;
        }
        let requested_path = linked_dir.join("missing-managed.pdf");

        let resolved =
            managed_pdf_path(&source_path, requested_path.to_str(), &managed_copy_dir).unwrap();

        assert_ne!(resolved, requested_path);
        assert!(resolved.starts_with(&managed_copy_dir));
        fs::remove_dir_all(&managed_copy_dir).unwrap();
        fs::remove_dir_all(&outside_dir).unwrap();
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!(
            "smartreader-managed-copy-{name}-{}-{timestamp}",
            std::process::id()
        ))
    }
}
