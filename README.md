<h1 align="center">


  <img src="https://github.com/user-attachments/assets/d3e69ed5-9bd7-4dec-90e3-3dcd449bb5df" height="200" alt="VolWeb">
  <br/>
  Thanatology
</h1>



Thanatology is a project built using the Tauri framework to deliver a cross-platform digital forensics desktop application. It leverages the power of the [Exhume toolkit](https://www.forensicxlab.com/docs/exhume) as a core library and uses React with MUI to showcase how a modern application **tailored for law enforcement** can be developed. The goal of Thanatology is to provite an all in one Framework to perform Post-Mortem Analysis, Malware Analysis and Memory Analysis. The project is also meant to include helpfull judicial tools for a court acceptable digital forensics report.

> [!IMPORTANT]
> This project is in active developpement and is has not yet released.

# Our Roadmap

This roadmap is dynamic, consider all of the alpha tagged release as not production ready for a real case investigation.

## v2026-1-alpha : Release (Q1 of 2026)

- [x] Case and Evidence management.
- [x] Sqlite Support
- [x] Filesystem processing: (NTFS/ExFAT/ExtFS).
- [x] FileSystem Artefact extraction.
- [X] Logical And Physical Acquisition support.
- [X] Disk Layout Discovery and Partition Selection for Physical Analysis.
- [ ] Optimized File Viewer.
- [x] Terminal Intergration: (Bash, ZSH, Powershell).
- [ ] AI integration for artifacts description, content summary on demand. 


## v2026-2-alpha: Release (Q2 of 2026)
- [ ] Embeded advanced Hexadecimal Editor
- [ ] Memory Forensics Basic Features
- [ ] ProcMon Artefacts Vizualisation for Malware Analysis.

## v2026-3-alpha Release (Q3 of 2026)

TBD

# Join the community

We intend to build a community to participate to the creation of this tool. Join the Discord server [here](Discord) !

# Testing

The Thanatology project is not production and not release is published yet. However you can test the application using the following commands:

```
git clone --recurse-submodules https://github.com/forensicxlab/exhume
git clone https://github.com/forensicxlab/thanatology
cd thanatology
npm install
npm run tauri dev
```
