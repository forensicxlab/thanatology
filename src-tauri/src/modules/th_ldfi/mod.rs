use exhume_filesystem::filesystem::{DirEntryCommon, Filesystem};
use exhume_progress::{emit_progress_event, ProgressMessageLevel, ProgressMessageType};
use log::{debug, info};
// use std::time::Duration;

use tauri::{AppHandle, Emitter};
// use tokio::time::sleep;
use exhume_ldfi::{build_tree_iterative_fs, convert_entire_tree, PlainFileSystemNode};
use sqlx::sqlite::{Sqlite, SqlitePool};
use sqlx::Pool;

/// Our Tauri command to process the LDFI indexation by:
/// 1) Building the entire filesystem tree in memory.
/// 2) Converting it to a “plain” node structure.
/// 3) Flattening that tree into a Vec.
/// 4) Inserting all records in a single bulk insert (one transaction).
pub async fn process_ldfi<T: Filesystem>(
    fs: &mut T,
    evidence_id: i64,
    partition_id: i64,
    app: &AppHandle,
    pool: Pool<Sqlite>,
) where
    T::InodeType: 'static,
    T::DirEntryType: DirEntryCommon,
{
    info!("Strarting LDFI Module...");
    // (Optional) Create or ensure indexes to speed up queries:
    if let Err(e) = sqlx::query(
        r#"
            CREATE INDEX IF NOT EXISTS idx_linux_files_inode
                ON linux_files(inode_number);
            CREATE INDEX IF NOT EXISTS idx_linux_files_ev_path
                ON linux_files(evidence_id, absolute_path);
            "#,
    )
    .execute(&pool)
    .await
    {
        app.emit(
            "main_progress_error",
            format!("Error creating indexes: {e:?}"),
        )
        .ok();
    }

    let nodes = match build_tree_iterative_fs(fs, Some(&app), Some(&evidence_id)) {
        Ok(root_node_rc) => {
            // Convert to plain serializable structure:
            let plain_root = convert_entire_tree(&root_node_rc);
            // Flatten the entire tree (DFS) into a single Vec of nodes:
            let mut all_nodes = Vec::new();
            flatten_plain_tree(&plain_root, &mut all_nodes);
            Ok(all_nodes)
        }
        Err(e) => Err(format!("Failed building FS tree: {e}")),
    }
    .unwrap();

    // We can estimate "total" as the number of nodes discovered:
    info!("Ingesting the tree in database...");

    emit_progress_event(
        &evidence_id,
        ProgressMessageLevel::Module,
        ProgressMessageType::Info,
        "Ingesting the tree in database...",
        app,
    );
    // 5) Perform one bulk insert of all nodes in a single transaction.
    if let Err(e) = bulk_insert_nodes(&pool, evidence_id, partition_id, &nodes, &app).await {
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Error,
            format!("Bulk insert error: {e:?}"),
            app,
        );
    } else {
        // If successful, emit the total as "progress_complete."
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Success,
            "Succesfully injected the all of results to the database.",
            app,
        );
    }
}

/// Recursively traverses a PlainFileSystemNode and appends every node to "accumulator".
/// This is effectively a DFS flattening of the entire tree.
fn flatten_plain_tree(node: &PlainFileSystemNode, accumulator: &mut Vec<PlainFileSystemNode>) {
    accumulator.push(node.clone());
    if let Some(children) = &node.children {
        for child in children {
            flatten_plain_tree(child, accumulator);
        }
    }
}

/// Uses a single transaction to bulk-insert all file records for better performance.
/// Adds "evidence_id" to each file record before insertion.
async fn bulk_insert_nodes(
    pool: &SqlitePool,
    evidence_id: i64,
    partition_id: i64,
    nodes: &[PlainFileSystemNode],
    app: &AppHandle,
) -> Result<(), sqlx::Error> {
    let total_count = nodes.len() as u64;

    // Start transaction
    let mut tx = pool.begin().await?;

    // Prepared statement we'll reuse:
    let stmt_str = r#"
        INSERT INTO linux_files (
            evidence_id,
            partition_id,
            absolute_path,
            filename,
            parent_directory,
            inode_number,
            file_type,
            size_bytes,
            owner_uid,
            group_gid,
            permissions_mode,
            hard_link_count,
            access_time,
            modification_time,
            change_time,
            creation_time,
            extended_attributes,
            symlink_target,
            mount_point,
            filesystem_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    "#;

    let mut processed = 0u64;
    for plain_node in nodes {
        // Instead of moving the linuxfile, borrow it.
        let lf = &plain_node.linuxfile;
        // We can supply the evidence_id directly in the query binding rather than modifying lf.
        let ext_attrs_text = lf.extended_attributes.to_string();

        if let Err(e) = sqlx::query(stmt_str)
            .bind(Some(evidence_id))
            .bind(partition_id)
            .bind(&lf.absolute_path)
            .bind(&lf.filename)
            .bind(&lf.parent_directory)
            .bind(lf.inode_number as i64)
            .bind(&lf.file_type)
            .bind(lf.size_bytes as i64)
            .bind(lf.owner_uid as i64)
            .bind(lf.group_gid as i64)
            .bind(lf.permissions_mode as i64)
            .bind(lf.hard_link_count as i64)
            .bind(&lf.access_time)
            .bind(&lf.modification_time)
            .bind(&lf.change_time)
            .bind(&lf.creation_time)
            .bind(ext_attrs_text)
            .bind(&lf.symlink_target)
            .bind(&lf.mount_point)
            .bind(&lf.filesystem_type)
            .execute(&mut *tx)
            .await
        {
            emit_progress_event(
                &evidence_id,
                ProgressMessageLevel::Module,
                ProgressMessageType::Error,
                format!("DB insert error: {e:?}"),
                app,
            );
        }

        processed += 1;
        // Optional: emit incremental progress
        emit_progress_event(
            &evidence_id,
            ProgressMessageLevel::Module,
            ProgressMessageType::Info,
            format!(
                "Indexing {}/{} inodes into the database...",
                processed, total_count
            ),
            app,
        );
    }

    // Commit transaction when done
    tx.commit().await?;
    Ok(())
}
