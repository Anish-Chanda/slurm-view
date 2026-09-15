## Installation

```bash
VERSION="{{TAG}}"

wget "https://github.com/Anish-Chanda/slurm-view/releases/download/${VERSION}/slurm-view-${VERSION}.tar.gz"
wget "https://github.com/Anish-Chanda/slurm-view/releases/download/${VERSION}/slurm-view-${VERSION}.tar.gz.sha256"

sha256sum -c "slurm-view-${VERSION}.tar.gz.sha256"

tar -xzf "slurm-view-${VERSION}.tar.gz"
cd "slurm-view-${VERSION}"

npm ci --omit=dev
```

The release archive contains the prebuilt server and web client. No TypeScript, React, or Vite build is required on the target system.

---
