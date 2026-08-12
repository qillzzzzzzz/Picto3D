<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class DetectFrameRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'frame' => [
                'required',
                'image',
                'mimes:jpeg,jpg,png,webp',
                'max:2048',
            ],
            'confidence' => [
                'nullable',
                'numeric',
                'min:0.05',
                'max:1',
            ],
            'model' => [
                'nullable',
                'string',
                'max:50',
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'frame.required' => 'Frame kamera wajib dikirim.',
            'frame.image' => 'Frame harus berupa gambar yang valid.',
            'frame.mimes' => 'Frame harus menggunakan format JPEG, PNG, atau WebP.',
            'frame.max' => 'Ukuran frame tidak boleh melebihi 2 MiB.',
        ];
    }
}