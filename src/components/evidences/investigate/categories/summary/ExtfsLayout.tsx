import React, { useState } from "react";
import { Box, Typography } from "@mui/material";

export default function ExtfsLayout({ superblock }: { superblock: any }) {
  const blockSize = 1024 << superblock.s_log_block_size;
  const numGroups = Math.ceil(
    superblock.s_blocks_count / superblock.s_blocks_per_group,
  );
  const groupDescBytes =
    numGroups * (superblock.s_journaling?.s_desc_size || 64);
  const groupDescBlocks = Math.ceil(groupDescBytes / blockSize);
  const inodeTableBlocks =
    (superblock.s_inodes_per_group * superblock.s_inode_size) / blockSize;

  // Sizes in blocks for Group 0
  const layout = [
    { name: "Group 0 Padding", blocks: 1024 / blockSize, color: "#041014" },
    { name: "Superblock", blocks: 1, color: "#145369" },
    { name: "Group Descriptors", blocks: groupDescBlocks, color: "#D94827" },
    {
      name: "Reserved GDT Blocks",
      blocks: 2,
      color: "#041014",
      placeholder: true,
    },
    { name: "Block Bitmap", blocks: 1, color: "#4db6ac" },
    { name: "Inode Bitmap", blocks: 1, color: "#4db6ac" },
    { name: "Inode Table", blocks: inodeTableBlocks, color: "#81c784" },
    {
      name: "Data Blocks",
      blocks:
        superblock.s_blocks_per_group -
        (1 + groupDescBlocks + 2 + 1 + 1 + inodeTableBlocks),
      color: "#BAB03D",
    },
  ];

  // Total blocks for scaling
  const totalBlocks = layout.reduce((sum, sec) => sum + sec.blocks, 0);

  let currentOffsetBytes = 0;

  return (
    <>
      <Box
        sx={{
          display: "flex",
          border: "1px solid #ccc",
          borderRadius: "2px",
          overflow: "hidden"
        }}>
        {layout.map((section, idx) => {
          const widthPercent = (section.blocks / totalBlocks) * 100;
          const offsetHex = "0x" + currentOffsetBytes.toString(16);
          const blockBytes = section.blocks * blockSize;
          currentOffsetBytes += blockBytes;

          return (
            <Box
              key={idx}
              sx={{
                flex: `0 0 ${widthPercent}%`,
                bgcolor: section.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",

                borderRight:
                  idx < layout.length - 1 ? "1px solid #fff" : "none"
              }}>
              <Typography
                variant="caption"
                align="center"
                style={{ padding: "4px" }}
              >
                {section.name}
                <br />
                {section.placeholder
                  ? "many blocks"
                  : `${section.blocks} blocks`}
              </Typography>
              {/* Offset label below */}
              <Box
                style={{ fontSize: "0.7rem" }}
                sx={{
                  position: "absolute",
                  bottom: "-20px",
                  left: "0"
                }}>
                {offsetHex}
              </Box>
            </Box>
          );
        })}
      </Box>
    </>
  );
}
